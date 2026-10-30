/**
 * The ONE standardized prompt every personal avatar is generated with (docs/DESIGN.md §3).
 * Same style, light, framing, detail and background for everyone, so a team looks like one cast.
 * Change it only deliberately, and bump the version: avatars made with an older version stay as they are.
 */
export const AVATAR_STYLE_VERSION = "2026-10-v1";

/** Solid background of every personal avatar (people), distinct from the assistants' pastel halos. */
export const AVATAR_BACKGROUND = "#1C1C21";

export const AVATAR_PROMPT = [
  "Turn the person in this photo into a stylized 3D avatar for a professional workplace app.",
  "Likeness first: keep the person clearly recognizable. Preserve their face shape, skin tone, eye colour and eye shape, eyebrows, nose, lips, hairstyle, hair colour and length, facial hair, glasses and visible piercings exactly as in the photo. Do not change their apparent age, gender or ethnicity. Do not beautify, slim or caricature.",
  "Style: premium stylized 3D character, like modern messaging-app avatars: soft rounded volumes, smooth matte clay-like skin with a subtle warm subsurface glow, clean simple textures, no skin pores and no photographic detail. Head and eyes slightly larger than real proportions. Friendly, calm expression with a gentle closed-mouth smile, eyes looking at the viewer.",
  "Framing: head and the top of the shoulders, centered, facing the camera with a very slight turn to the left. The top of the hair about 12% below the top edge; the shoulders cut by the bottom edge.",
  "Clothing: a simple plain top in a muted neutral colour; no logos, no text, no jewellery added.",
  "Lighting: soft diffuse studio key light from the upper left, gentle fill light, a subtle cool rim light that separates the character from the background.",
  `Background: solid flat very dark charcoal grey (${AVATAR_BACKGROUND}), no gradient, no objects, no shadow.`,
  "Output: one character only, square image, no text, no watermark, no border, no frame.",
].join("\n");
