# Render worker (docs/ARCHITECTURE.md §10). Build from the repository root:
#   docker build -f worker/Dockerfile -t render-worker .
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app/worker
# The headless browser HyperFrames uses is downloaded here, in a folder every user can read.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY worker/build.mjs ./
COPY worker/src ./src
COPY src/modules/render /app/src/modules/render
RUN node build.mjs && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-inter \
     libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
     libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --user-group render
WORKDIR /app/worker
COPY --from=build /app/worker/node_modules ./node_modules
COPY --from=build /app/worker/dist ./dist
COPY --from=build /opt/puppeteer /opt/puppeteer
ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    CAPTION_FONT_FILE=/usr/share/fonts/opentype/inter/Inter-SemiBold.otf \
    RENDER_CHILD_UID=10001 \
    RENDER_CHILD_GID=10001 \
    RENDER_CHILD_HOME=/home/render
# The main process keeps the keys and starts each render as the "render" user (see src/index.ts).
CMD ["node", "dist/index.js"]
