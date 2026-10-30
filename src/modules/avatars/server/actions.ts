"use server";

import { revalidatePath } from "next/cache";
import { getAppContext } from "@/lib/auth/context";
import type { ActionResult } from "@/lib/errors";
import { choosePendingAvatar, discardPendingAvatar, removeAvatar } from "./store";

/** The person keeps the avatar they just generated. */
export async function chooseAvatarAction(): Promise<ActionResult<{ avatarUrl: string }>> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "forbidden" };
  const avatarUrl = await choosePendingAvatar(ctx.user.id);
  if (!avatarUrl) return { ok: false, error: "not_found" };
  revalidatePath("/", "layout");
  return { ok: true, data: { avatarUrl } };
}

/** "Not this one": the generated image is deleted. */
export async function discardAvatarAction(): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "forbidden" };
  await discardPendingAvatar(ctx.user.id);
  return { ok: true };
}

/** Back to initials; the stored images are deleted. */
export async function removeAvatarAction(): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!ctx) return { ok: false, error: "forbidden" };
  await removeAvatar(ctx.user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}
