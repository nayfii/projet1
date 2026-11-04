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
| Motion | 150–320 ms, ease-out-soft; messages rise 6 px as they appear; characters breathe only while they work; everything stops for people who ask for reduced motion | `globals.css` |
| Logo | The existing mark kept (a tile with a dot); the dot became a small pastel orb | `components/brand/logo.tsx` |
| Light theme | Still available per device (account menu → Apparence): Sombre (default), Clair, Comme l'appareil | `lib/theme.ts` |

## 2. AI assistants: a cast of characters

- **One character per assistant** (since 2026-11-03, the founder's reference): the glossy 3D robot of Microsoft's
  Fluent Emoji (MIT licence, shipped in `public/avatars/assistants/LICENSE-fluent-emoji.txt`), one colour each:
  ChatGPT mint, Claude orange, Gemini blue, Auto the original pink and yellow. Same shape, so they read as one family;
  the colour of the antennas and the top light tells them apart at 24 px.
- **Clearly AI.** They are friendly robots, not human faces: in a group conversation nobody can mistake an assistant for
  a colleague (people have human avatars). The model's name is always written next to its character.
- **Alive, not a game.** The eyes and mouth are drawn live on the robot's visor: it blinks at rest, glances around while it
  thinks, talks while it writes, smiles (^ ^) for a moment when it is done. In a long thread only the assistant at work moves.
- **Where they appear**: next to each answer; in a quiet column beside the thread on wide screens (the one at work is
  larger and says "réfléchit…" or "écrit…"), as a small stack in the header on smaller screens; as a picker on the empty
  conversation (clicking a character chooses it); in the model picker and the "@" menu; around the table in Confronter
  (each one thinks, critiques, then the judge writes the synthesis).
- **Source**: `scripts/avatars/fluent-assistants.py` makes the four images from the Fluent robot (it removes the eyes
  and mouth, which the app draws, and recolours the antennas). The face geometry is `ROBOT_FACE` in
  `src/modules/avatars/assistants.ts`.

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

## 4. Liquid Glass experiment (v18, 2026-11-04) — branch `experiment/liquid-glass-v18`

The founder's brief: Apple's Liquid Glass, organic living backgrounds, a premium floating sidebar (references: "Glassy
Sidebar V5", violet silk folds, an amber sunset). **An experiment on its own branch**: the version customers use is
unchanged until the founder accepts it.

| Element | Rule | Where |
|---|---|---|
| Appearance | Two independent choices per device: the interface (Clair, Sombre, Système) and the background (Midnight Aurora, Solar Ember), plus "Fond animé". Settings → Apparence (profile; our console: Apparence in the account menu). Cookies read by the root layout, so the first paint is right; "Système" is resolved before the first paint by a tiny script | `lib/theme.ts`, `components/appearance/*`, `app/layout.tsx` |
| Backgrounds | Midnight Aurora: four silk folds (shadow, coloured glow, lit edge) in night blue, indigo, violet and plum on near-black; Solar Ember: a band of light from gold to red over a dark wave, violet glow below. Light versions: pearl satin and a pastel sunset. Inline SVG painted once, a grain against banding, a scrim for readable text | `components/shell/ambient-background.tsx`, `app/appearance.css` |
| Motion | Two layers drift well under a pixel a second, translated three times a second (never repainted); still with "Fond animé" off, reduced motion, a hidden tab, or a low-power device | `components/shell/ambient-motion.tsx` |
| Glass materials | `glass-subtle` (rows, chips), `glass-standard` (lists, bubbles), `glass-elevated` / `glass-solid` (floating, blurred), `glass-interactive` (hover, selected); content-heavy surfaces (tables, long forms, menus) use the firmer fills | `app/appearance.css` |
| Liquid Glass (glisse) | Panes that bend the backdrop at their rim, with a painted lit edge and light colour dispersion: sidebar, cards, chat composer, dialogs, menus, sign-in and onboarding panes, the mobile bar; the bend is given in pixels (`reach`) so small and tall panes match. Chromium bends the live backdrop; Safari and Firefox keep the frost and the lit rim | `components/ui/liquid-glass.tsx` |
| Sidebar | A floating glass panel; the current page is marked by a small glass lens that slides to it; collapsible to a rail of icons with tooltips (cookie per device); Clients and Search keep an icon in the rail | `components/shell/app-shell.tsx` |
| Controls | Switches are glisse's Liquid Glass switch (in our accent); the interface choice uses glisse's segmented control | `components/ui/switch.tsx`, `appearance-settings.tsx` |
| Accent | Follows the background: lavender-violet with Aurora, warm coral with Ember (deeper in light mode for contrast) | `--brand` |
| Motion tokens | 150 ms controls, 220 ms panels, 300 ms layout; no bounce | `--dur-*` |
| Performance | No blur stacking (cards have little frost; only floating panes blur); a once-per-visit frame-rate check marks a struggling device "low power": still background, glass without bending | `components/appearance/performance-guard.ts` |
