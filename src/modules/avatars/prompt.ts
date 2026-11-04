/**
 * The ONE standardized prompt every personal avatar is generated with (docs/DESIGN.md §3).
 * Same style, light, framing, detail and background for everyone, so a team looks like one cast.
 * Change it only deliberately, and bump the version: avatars made with an older version stay as they are.
 */
export const AVATAR_STYLE_VERSION = "2026-11-v3";

/**
 * Every personal avatar is a cut-out on a transparent background (PNG), like the assistants' robots:
 * the app sets it on a pane of glass, black in the dark interface and white in the light one.
 */
export const AVATAR_BACKGROUND = "transparent";

export const AVATAR_PROMPT = [
  "Turn the person in this photo into a stylized 3D avatar for a professional workplace app.",
  "Likeness first: keep the person clearly recognizable. Preserve their face shape, skin tone, eye colour and eye shape, eyebrows, nose, lips, hairstyle, hair colour and length, facial hair, glasses and visible piercings exactly as in the photo. Do not change their apparent age, gender or ethnicity. Do not beautify, slim or caricature.",
  "Style: a 3D emoji-style head, like the glossy 3D emoji of modern operating systems (the same family as the app's 3D robot assistants): very simple rounded shapes, soft glossy clay-like surfaces with smooth gradients and gentle highlights, no skin pores and no photographic detail. A rounded head, slightly larger than real proportions, with big friendly eyes (in the person's own eye colour) with a small white highlight, simple eyebrows, a small nose and a gentle closed-mouth smile; the hair as one soft sculpted volume. Eyes looking at the viewer.",
  "Framing: the head only, with a hint of the neck, centered and facing the camera, filling about 80% of the image height. No shoulders, no body, no clothing.",
  "Lighting: soft diffuse studio key light from the upper left, gentle fill light, a subtle cool rim light that separates the character from the background.",
  `Background: fully ${AVATAR_BACKGROUND}: a clean cut-out of the character with smooth anti-aliased edges, no backdrop, no gradient, no objects, no cast shadow.`,
  "Output: one character only, square image, no text, no watermark, no border, no frame.",
].join("\n");
