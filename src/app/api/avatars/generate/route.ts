import { memberOrNull } from "@/lib/auth/guards";
import { getMyQuota } from "@/modules/usage/server/quota";
import { logBlockedRequest, recordUsage } from "@/modules/usage/server/record";
import { AVATAR_DAILY_LIMIT, AVATAR_PHOTO_MAX_BYTES, sniffPhotoType, type AvatarError } from "@/modules/avatars/files";
import { generateAvatar } from "@/modules/avatars/server/generate";
import { avatarRate, recentAvatarGenerations, savePendingAvatar } from "@/modules/avatars/server/store";

/** Image models take a while: up to two minutes. */
export const maxDuration = 120;

function fail(error: AvatarError, status: number) {
  return Response.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Turns the signed-in person's photo into their 3D avatar (shown for approval, not used yet).
 * The photo is read in memory, sent to the image model, and never stored. Metadata only is logged.
 */
export async function POST(request: Request) {
  const member = await memberOrNull();
  if (!member) return fail("forbidden", 403);
  const userId = member.user.id;
  const companyId = member.active.companyId;

  if (Number(request.headers.get("content-length") ?? 0) > AVATAR_PHOTO_MAX_BYTES + 64 * 1024) return fail("too_large", 413);
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return fail("invalid_photo", 400);
  if (file.size > AVATAR_PHOTO_MAX_BYTES) return fail("too_large", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffPhotoType(bytes)) return fail("invalid_photo", 400);

  if ((await recentAvatarGenerations(userId)) >= AVATAR_DAILY_LIMIT) return fail("rate_limited", 429);
  const quota = await getMyQuota(companyId);
  if (quota?.state.state === "blocked") {
    await logBlockedRequest(companyId, userId, quota.state.scope === "user" ? "quota_user" : "quota_company");
    return fail("quota", 402);
  }

  const rate = await avatarRate();
  const started = Date.now();
  const usage = { companyId, userId, feature: "avatar" as const, conversationId: null, messageId: null, provider: "openai" as const, autoRouted: false, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, tokensEstimated: false };
  let result: Awaited<ReturnType<typeof generateAvatar>>;
  try {
    result = await generateAvatar(bytes, new URL(request.url).origin);
  } catch (error) {
    const code = error instanceof Error && error.name ? error.name : "unknown";
    await recordUsage({ ...usage, modelId: "avatar", apiModelId: "avatar", credits: 0, estimatedCostUsd: 0, status: "error", errorCode: code.slice(0, 60), latencyMs: Date.now() - started });
    return fail("failed", 502);
  }
  if (result === "not_configured") return fail("not_configured", 503);

  const fileId = await savePendingAvatar(userId, result.bytes, result.mediaType);
  await recordUsage({
    ...usage,
    modelId: result.model,
    apiModelId: result.model,
    credits: rate.credits,
    estimatedCostUsd: result.test ? 0 : rate.costUsd,
    status: "ok",
    errorCode: null,
    latencyMs: Date.now() - started,
  });
  return Response.json({ ok: true, previewUrl: `/api/avatars/${userId}?pending=${fileId}`, test: result.test }, { headers: { "Cache-Control": "no-store" } });
}
