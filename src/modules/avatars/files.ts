/** Photos accepted for an avatar (the browser re-encodes them to JPEG before sending; see avatar-studio.tsx). */
export const AVATAR_PHOTO_MAX_BYTES = 6 * 1024 * 1024;
export const AVATAR_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarPhotoType = (typeof AVATAR_PHOTO_TYPES)[number];

/** Generations per person per 24 hours (cost control; each one also counts against credits). */
export const AVATAR_DAILY_LIMIT = 6;

/** Recognises a photo by its first bytes, never by its name or the type the browser claims. */
export function sniffPhotoType(bytes: Uint8Array): AvatarPhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** Version token in an avatar URL: the stored file's id. */
export function avatarUrlFor(userId: string, fileId: string): string {
  return `/api/avatars/${userId}?v=${fileId}`;
}

export const AVATAR_ERRORS = ["invalid_photo", "too_large", "rate_limited", "quota", "failed", "not_configured", "forbidden"] as const;
export type AvatarError = (typeof AVATAR_ERRORS)[number];
