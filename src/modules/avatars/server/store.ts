import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { avatarUrlFor } from "../files";

/**
 * AUDITED service-role module (docs/ARCHITECTURE.md §5). The avatars bucket has no policy for
 * signed-in people: every read and write goes through here, after the caller was checked.
 * Paths are always "<user id>/<file id>.<ext>" for the user acting on their own profile.
 */
const BUCKET = "avatars";
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" } as const;

export async function savePendingAvatar(userId: string, bytes: Uint8Array, mediaType: keyof typeof EXT): Promise<string> {
  const admin = createAdminClient();
  const fileId = randomUUID();
  const path = `${userId}/${fileId}.${EXT[mediaType]}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: mediaType, upsert: false });
  if (error) throw new Error("avatar_upload_failed");
  const { data: before } = await admin.from("profiles").select("avatar_pending_path").eq("id", userId).single();
  await admin.from("profiles").update({ avatar_pending_path: path }).eq("id", userId);
  if (before?.avatar_pending_path) await admin.storage.from(BUCKET).remove([before.avatar_pending_path]);
  return fileId;
}

/** The person keeps the image they just generated: it becomes their avatar everywhere. */
export async function choosePendingAvatar(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("avatar_path, avatar_pending_path").eq("id", userId).single();
  if (!data?.avatar_pending_path) return null;
  const fileId = fileIdOf(data.avatar_pending_path);
  const url = avatarUrlFor(userId, fileId);
  const { error } = await admin
    .from("profiles")
    .update({ avatar_path: data.avatar_pending_path, avatar_pending_path: null, avatar_url: url })
    .eq("id", userId);
  if (error) throw new Error("avatar_choose_failed");
  if (data.avatar_path) await admin.storage.from(BUCKET).remove([data.avatar_path]);
  return url;
}

export async function discardPendingAvatar(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("avatar_pending_path").eq("id", userId).single();
  if (!data?.avatar_pending_path) return;
  await admin.from("profiles").update({ avatar_pending_path: null }).eq("id", userId);
  await admin.storage.from(BUCKET).remove([data.avatar_pending_path]);
}

/** Back to initials: the image is deleted, not just hidden. */
export async function removeAvatar(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("avatar_path, avatar_pending_path").eq("id", userId).single();
  await admin.from("profiles").update({ avatar_path: null, avatar_pending_path: null, avatar_url: null }).eq("id", userId);
  const paths = [data?.avatar_path, data?.avatar_pending_path].filter((p): p is string => Boolean(p));
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
}

/** Reads a stored avatar image. The caller has already checked that the viewer may see it. */
export async function readAvatarFile(path: string): Promise<Blob | null> {
  const { data } = await createAdminClient().storage.from(BUCKET).download(path);
  return data ?? null;
}

/** Credits charged per generation and its estimated cost, set by our team (platform settings). */
export async function avatarRate(): Promise<{ credits: number; costUsd: number }> {
  const { data } = await createAdminClient().from("platform_settings").select("avatar_credits, avatar_cost_usd").single();
  return { credits: Number(data?.avatar_credits ?? 0), costUsd: Number(data?.avatar_cost_usd ?? 0) };
}

/** Generations by this person in the last 24 hours (successful or not), for the daily limit. */
export async function recentAvatarGenerations(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await createAdminClient()
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("feature", "avatar")
    .gte("created_at", since);
  return count ?? 0;
}

export function fileIdOf(path: string): string {
  return path.slice(path.indexOf("/") + 1, path.lastIndexOf("."));
}
