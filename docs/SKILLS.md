# Agent skills used to build Cendr

Skills are instructions and helper files for the coding agent (Claude Code). They live in
`.claude/skills/` and are listed in `skills-lock.json`. They are **not part of the product**: the app
neither imports nor ships them (excluded from the type check, lint and Tailwind sources).

**Rule (founder, 2026-11-11):** a skill is installed only after its licence is checked, at the level of
the skill itself (a repository can mix licences). MIT: installed. Other permissive licences (Apache-2.0,
BSD, ISC): asked first. No licence, copyleft (GPL, AGPL), non-commercial (CC-NC), "source-available" or
proprietary: not installed. Each skill's content is read before it is used (no network calls, no
unexpected commands). If code from a skill is copied into Cendr, its copyright notice and licence text
are kept next to it.

| Skill | Source | Revision | Licence (checked) | Checked on | Notes |
|---|---|---|---|---|---|
| `stageshow` | [benjitaylor/skills](https://github.com/benjitaylor/skills) › `stageshow/` | `299140f` | **MIT** — © 2026 Benji Taylor (`stageshow/LICENSE`); the repository root has no licence file, each skill carries its own | 2026-11-11 | Faux product UI and animated demos (marketing pages, feature cards). Bundled **brand logos and app icons are not covered by MIT** (`kit/brands/SOURCES.md`, `assets/app-icons.ts`: SVGL MIT, payment-icons Apache-2.0, CC0 icons, and official Linear, American Express, Circle marks under their brand terms): do not use other companies' marks in our material without their permission. Scripts only run the local playground; no network calls. |
