# Render worker

Makes the videos of the Motion Design and Video Editor agents (docs/ARCHITECTURE.md §10). It claims jobs
from the `render_jobs` table, downloads the files they use, renders them (HyperFrames for animations,
FFmpeg for edits) in a child process without credentials, uploads the MP4s and reports back.

## Run locally

```bash
npm ci --prefix worker          # HyperFrames, GSAP, the Inter font, supabase-js
node worker/build.mjs           # bundles worker/src and src/modules/render into worker/dist
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SECRET_KEY=<service key from `supabase status`> \
PRODUCER_HEADLESS_SHELL_PATH=<path to chrome-headless-shell, optional> \
node worker/dist/index.js
```

Needs Node 22+, FFmpeg/ffprobe on the PATH and, for captions, the Inter font (`CAPTION_FONT_FILE`,
default `/usr/share/fonts/opentype/inter/Inter-SemiBold.otf`).

## Container

```bash
docker build -f worker/Dockerfile -t render-worker .   # from the repository root
docker run --env SUPABASE_URL=… --env SUPABASE_SECRET_KEY=… render-worker
```

The main process keeps the key and starts each render as the unprivileged `render` user
(`RENDER_CHILD_UID`). Give the container network access to Supabase only. Not built yet in the
development environment (its network blocks the package mirrors); to verify at deployment.

| Variable | Default | Meaning |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | — | Database and storage (service role) |
| `RENDER_POLL_MS` | 2000 | Pause between two looks at the queue when it is empty |
| `RENDER_JOB_TIMEOUT_MS` | 900000 | A render taking longer is stopped |
| `RENDER_CHILD_UID`, `RENDER_CHILD_GID`, `RENDER_CHILD_HOME` | — | User the renders run as (container) |
| `CAPTION_FONT_FILE` | Inter SemiBold | Font of the Video Editor's captions |
