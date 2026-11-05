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

## 4. Liquid Glass experiment (v18, 2026-11-04/05) — branch `experiment/liquid-glass-v18`

The founder's brief: Apple's Liquid Glass, living backgrounds, a premium floating sidebar (references: "Glassy Sidebar
V5", violet silk folds, an amber sunset). Revised after the founder's review of 2026-11-04 (plain Clair and Sombre, a
third interface with colours, smooth moving backgrounds, a fluid sidebar, glass lens between rows, avatars on glass).
**An experiment on its own branch**: the version customers use is unchanged until the founder accepts it.

| Element | Rule | Where |
|---|---|---|
| Interfaces | **Sombre** (default): plain near-black `#09090b`, glass on top. **Clair**: plain `#f7f7f9`, glass on top. **Système**: follows the device. **Atmosphère**: glass over a living background, in one of six palettes. Per device (cookies read by the root layout; "Système" resolved before the first paint by a tiny script) | `lib/theme.ts`, `app/layout.tsx` |
| Atmosphère palettes | Midnight Aurora (violet and night-blue silk), Solar Ember (amber band over a dark wave), Lagon (turquoise), Orchidée (rose and plum), Waylume (prismatic light, chosen by the founder from the Waylume studio) on dark glass; Nacre (lavender satin) and Pêche (pastel sunset) on light glass. Each gives the accent and the glass tint (CSS generated from the same definitions) | `lib/ambient/palettes.ts`, `lib/ambient/css.ts` |
| Waylume | The founder's export from sirolius.com/playground/waylume, kept verbatim as the studio asks (`components/ambient/WaylumeBackground.tsx`, excluded from lint). WebGL2, no network access, its light follows the pointer; loaded only when chosen, paused with "Fond animé" off or on a low-power device. It includes Paper Shaders (Apache 2.0, notice kept in the file). **Waylume's own licence for commercial use is to be confirmed by the founder** | `components/ambient/waylume-layer.tsx` |
| Backgrounds | A small WebGL shader draws every pixel: lit silk folds or a band of light, dithered against colour banding, so they stay smooth at any size (the earlier blurred SVG layers looked pixelated). Drawn at 75 % of the screen's pixels and smoothed by the browser; a veil keeps the reading column calm | `lib/ambient/renderer.ts`, `components/shell/ambient-canvas.tsx` |
| Motion | Visible but calm (folds sway, the band and wave drift over tens of seconds), 30 frames a second; still with "Fond animé" off, reduced motion, a hidden tab or a low-power device; nothing runs at all with Clair or Sombre | `ambient-canvas.tsx` |
| Glass materials | `glass-subtle` (rows, chips), `glass-standard` (cards, bubbles), `glass-elevated` / `glass-solid` (floating, blurred: menus and dialogs, ready at once), `glass-interactive` (hover, selected) | `app/appearance.css` |
| Liquid Glass (glisse) | Panes whose rim bends the backdrop with a painted lit edge and colour dispersion: sidebar, chat composer, sign-in and onboarding panes, mobile bar, home tiles and key figures (`<Card liquid>`), the sidebar lens. Each pane is frosted glass from the first paint; glisse's lens is a separate layer behind its content, added once the page is quiet (no pointer movement, scroll or key for a moment), so it never competes with the first clicks and never re-creates the content. Bounded panes only (computed per pixel). Chromium bends the live backdrop; Safari and Firefox keep the frost and the lit rim | `components/ui/liquid-glass.tsx` |
| Sidebar | Floating glass panel; collapse/expand lays the page out once then slides it (transform) while the panel's width animates on its own; the collapse button is centred on the line under the page header; a glass lens marks the current row and, when a row is pressed, lifts and follows the pointer across rows (conversations included), opening the row it is released on | `components/shell/app-shell.tsx` |
| Avatars | Cut-outs (transparent PNG) on a glass bead: black in dark interfaces, white in light ones, with a lit rim and a reflection. Assistants' robots ship as PNG; new personal avatars are generated as transparent PNG (prompt v3) | `appearance.css` (`.avatar-glass`), `modules/avatars/*` |
| Controls | Switches are glisse's Liquid Glass switch (in the accent); the interface choice uses glisse's segmented control | `components/ui/switch.tsx`, `appearance-settings.tsx` |
| Performance | No blur stacking; a device drawing without a graphics chip is caught before the first paint, a struggling one by a frame-rate check: still background, unbent glass, and Settings → Apparence offers to turn the effects back on | `lib/theme.ts` (SCHEME_SCRIPT), `components/appearance/performance-guard.ts` |
