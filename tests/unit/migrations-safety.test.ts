import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Deployment safety (V1.1 phase 12): the migrations that go out with V1.1 and after never destroy data.
 * No table, column, schema or type dropped, nothing truncated or deleted; a constraint, function or
 * policy dropped is one replaced in the same file. A migration that must remove data needs a backup and
 * a reviewed procedure (docs/DEPLOY.md), and an explicit exception here.
 */
const FROM = "20261113000000";
const files = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f >= FROM)
  .sort();
const code = (file: string) =>
  readFileSync(`supabase/migrations/${file}`, "utf8")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

describe("V1.1 migrations", () => {
  it("exist and are numbered in order", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files.every((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))).toBe(true);
  });

  it.each(files)("%s destroys no data", (file) => {
    const sql = code(file);
    expect(sql).not.toMatch(/\bdrop (table|schema|type|view|materialized view)\b/);
    expect(sql).not.toMatch(/\bdrop column\b/);
    expect(sql).not.toMatch(/(^|;)\s*truncate\b/);
    expect(sql).not.toMatch(/(^|;)\s*delete from\b/);
    expect(sql).not.toMatch(/\balter column [a-z_]+ (set data )?type\b/);
  });

  it.each(files)("%s replaces what it drops", (file) => {
    const sql = code(file);
    // A check widened or renamed: the table gets a constraint back in the same file.
    for (const m of sql.matchAll(/alter table ([a-z_.]+) drop constraint ([a-z_]+)/g)) expect(sql, `${m[2]}`).toContain(`alter table ${m[1]} add constraint `);
    for (const m of sql.matchAll(/drop function ([a-z_.]+)\(/g)) expect(sql, m[1]).toMatch(new RegExp(`create (or replace )?function ${m[1].replace(".", "\\.")}\\(`));
    for (const m of sql.matchAll(/drop policy ([a-z_]+) on ([a-z_.]+)/g)) expect(sql, m[1]).toMatch(new RegExp(`create policy ${m[1]} on ${m[2].replace(".", "\\.")}\\b`));
  });
});
