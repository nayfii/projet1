// Launch workflow: writes the next version into release.json and adds it to CHANGELOG.md.
// Usage: node scripts/release/bump.mjs "<notes>" "<change list file>" → prints the new version ("1.4").
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { nextVersion } from "./version.mjs";

const [notesArg = "", changesFile = ""] = process.argv.slice(2);
const release = JSON.parse(readFileSync("release.json", "utf8"));
const version = nextVersion(release.version);
const date = new Date().toISOString().slice(0, 10);
const notes = notesArg.trim().slice(0, 2000);
const changes = changesFile && existsSync(changesFile)
  ? readFileSync(changesFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 200)
  : [];

writeFileSync("release.json", JSON.stringify({ version, date, notes: notes || `Version ${version}.` }, null, 2) + "\n");

const entry = [`## v${version} — ${date}`, "", ...(notes ? [notes, ""] : []), ...changes.map((c) => `- ${c}`), ""].join("\n");
const previous = existsSync("CHANGELOG.md") ? readFileSync("CHANGELOG.md", "utf8").replace(/^# Versions\n+/, "") : "";
writeFileSync("CHANGELOG.md", `# Versions\n\n${entry}\n${previous}`);
process.stdout.write(version);
