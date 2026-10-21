import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundles the worker and the shared render code (src/modules/render) into dist/. Packages stay in
// node_modules; the shared files resolve them from this folder.
const here = fileURLToPath(new URL(".", import.meta.url));
await build({
  entryPoints: { index: `${here}src/index.ts`, "render-child": `${here}src/render-child.ts` },
  outdir: `${here}dist`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  nodePaths: [`${here}node_modules`],
  logLevel: "warning",
});
