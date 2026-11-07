# Design

Art direction, assistant characters and personal avatars (Step 11, 2026-10-30).
The founder's references: a near-black, ultra-minimal product page (white type, generous space, soft pastel touches)
and a stylized 3D avatar (soft volumes, diffuse light, a friendly face that reads even when small).

## 1. Art direction

**Principle: few elements, each one intentional.** The chat stays the centre; everything else is quiet until needed.

| Element | Rule | Where |
|---|---|---|
| Background | Near-black `oklch(0.135 0.004 285)` (≈ #08080b), never pure #000 (less harsh for hours of use) | `--background` |
| Surfaces | Two lifts only: cards `0.172`, popovers `0.195`. Borders are white at 8–13 % opacity, not grey lines | `--card`, `--popover`, `--border`, `--input` |
| Type | Inter with optical sizes (tighter at display sizes), soft white `0.965` for text, `0.69` for secondary text | `layout.tsx`, `--foreground`, `--muted-foreground` |
| Hierarchy | Display titles 28–32 px, semibold, tracking −0.025em; body 14–15 px; captions 11–13 px | components |
| Accent | One pastel lavender (`--brand`), for focus, the active item and links only | `--brand` |
| Pastel family | Lavender, peach, mint, sky, pearl: one per assistant, used as halos behind characters and in the logo's orb. Never for text | `--pastel-*` |
| Buttons | Pills. Primary = white pill with near-black text (as in the reference); secondary = outline or ghost | `components/ui/button.tsx` |
| Radii | Controls 10 px, cards 16 px, composer 20 px, buttons and avatars round | `--radius` scale |
| Motion | 150–320 ms, ease-out-soft; messages rise 6 px as they appear; a model's mark shows a thin breathing ring only while it works; everything stops for people who ask for reduced motion | `globals.css` |
| Logo | The existing mark kept (a tile with a dot); the dot became a small pastel orb | `components/brand/logo.tsx` |
| Light theme | Still available per device (account menu → Apparence): Sombre (default), Clair, Comme l'appareil | `lib/theme.ts` |

## 2. AI models: their providers' logos

- **Since 2026-11-07 (founder's request)** each model is shown by its provider's own logo (OpenAI, Claude, Gemini),
  unaltered, on a small neutral disc that follows the theme (`--avatar-surface`); "Auto" (the Smart Router) gets a plain
  sparkle. The model's name is always written next to it. This replaces the 3D robots of Step 11 (images and generator
  removed).
- **Source of the logos**: LobeHub Icons (`@lobehub/icons-static-svg` 1.102.0, MIT licence), paths copied into
  `src/modules/providers/ui/provider-logo.tsx`. The logos remain their owners' trademarks; they are used only to name the
  model that answered. OpenAI's mark takes the text colour (black or white), Claude's and Gemini's keep their colours.
- **Motion**: none at rest; a thin ring breathes around the logo while the model prepares or writes its answer (still for
  reduced motion). No permanent column beside the thread: the conversation uses the space (the "who is thinking" rail
  was removed on 2026-11-07, its information already being under each answer).
- **Where they appear**: next to each answer, in the model picker and the "@" menu, the empty conversation's picker,
  Confronter, the client brief, memory provider rules, and next to model names (instead of a coloured dot).

## 3. Personal avatars

**Journey (onboarding and profile):** choose a photo → the photo softens while a pastel ring turns and a few words say
what is happening → the avatar appears with a soft burst → "C'est moi !", "Réessayer" or "Annuler". Initials remain the
default and stay one click away. "Ma photo telle quelle" is marked *Bientôt*.

**Consistency comes from one fixed prompt** (`src/modules/avatars/prompt.ts`, versioned), used for everyone:

| Rule | Value |
|---|---|
| Likeness | Keep face shape, skin tone, eyes, eyebrows, nose, lips, hairstyle and colour, facial hair, glasses, piercings. Never change apparent age, gender or ethnicity; no beautifying, no caricature |
| Style | Premium stylized 3D, soft rounded volumes, smooth matte clay-like skin, no pores, slightly larger head and eyes, gentle closed-mouth smile |
| Framing | The head only (a hint of the neck), centred, facing the camera, about 80 % of the image height (since 2026-11, `2026-11-v2`) |
| Style | 3D emoji-style head (founder's reference, 2026-11-03): simple rounded glossy clay shapes, big eyes in the person's own colour with a small highlight, hair as one sculpted volume — the same family as the assistants' robots |
| Light | Soft key light from the upper left, gentle fill, subtle cool rim light |
| Background | Solid flat charcoal `#1C1C21`: people's avatars sit on dark, assistants on pastel halos |
| Output | One character, square 1024 × 1024, no text, watermark or frame |

**Technical choices**

- OpenAI image editing through the AI SDK, model `AVATAR_IMAGE_MODEL` (default `gpt-image-1.5`), `inputFidelity: high`
  (keeps the face), opaque background (no dependence on transparency support), WebP output.
- The browser squares and re-encodes the photo (≤ 1024 px JPEG), which also removes EXIF data and location. The server
  checks the bytes, keeps nothing but the result, and charges the credits set by our team (6 creations per person per day).
- Test mode (`AI_FAKE_PROVIDER=true`): no AI is called; a fixed demo character is returned and labelled as such.
- **Not verified yet against the real image model** (the OpenAI account has no credit): the first real avatars must be
  checked by eye, and the prompt adjusted if needed (then bump `AVATAR_STYLE_VERSION`).
