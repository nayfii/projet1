"use client";

import { createBrowserSupabase } from "@/lib/supabase/client";
import { VIDEO_TYPES, videoExtensionOf, type VideoMedia } from "../formats";
import { readMp4Media } from "../mp4-info";

/** Duration and size of a video, read by the browser (indicative: the worker reads the file again). */
function readVideoMedia(file: File): Promise<VideoMedia | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (media: VideoMedia | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(media);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? { duration: Math.round(video.duration * 100) / 100, width: video.videoWidth, height: video.videoHeight } : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 10_000);
    video.src = url;
  });
}

/** The browser's reading first; for MP4 and MOV it cannot decode, the file's own header. */
async function videoMedia(file: File): Promise<VideoMedia | null> {
  const played = await readVideoMedia(file);
  if (played && played.duration > 0 && played.width > 0) return played;
  if (!/\.(mp4|mov)$/i.test(file.name)) return played;
  const read = async (offset: number, length: number) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  return (await readMp4Media(read, file.size).catch(() => null)) ?? played;
}

/**
 * Sends a video clip to the conversation: straight to the private `render-media` bucket with the
 * person's own session (storage rules: participants only), then registered and checked by our server.
 */
export async function uploadVideo(conversationId: string, file: File): Promise<{ id: string; filename: string; kind: "video"; truncated: false } | null> {
  const ext = videoExtensionOf(file.name);
  if (!ext) return null;
  const media = await videoMedia(file);
  const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await createBrowserSupabase().storage.from("render-media").upload(path, file, { contentType: VIDEO_TYPES[ext].mime, upsert: false });
  if (error) return null;
  const response = await fetch(`/api/conversations/${conversationId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, filename: file.name, size: file.size, media }),
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as { id?: string; filename?: string } | null;
  if (!response?.ok || !body?.id) return null;
  return { id: body.id, filename: body.filename ?? file.name, kind: "video", truncated: false };
}
