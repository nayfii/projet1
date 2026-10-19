import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Next.js refuses, at run time only, a "use server" file that exports anything but async functions. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('"use server" files', () => {
  const serverFiles = files(join(process.cwd(), "src")).filter((f) => /^\s*["']use server["'];/.test(readFileSync(f, "utf8")));

  it("exist", () => {
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  it.each(serverFiles.map((f) => [f.replace(process.cwd(), "")]))("%s exports only async functions and types", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const exports = [...source.matchAll(/^export\s+(?!type\b|interface\b|async\s+function\b)(\w+)/gm)].map((m) => m[0]);
    expect(exports).toEqual([]);
  });
});
