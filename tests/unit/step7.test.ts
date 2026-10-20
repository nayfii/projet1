import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import { BUILTIN_AGENTS, CHART_INSTRUCTION } from "@/modules/agents/builtins";
import { LAUNCH_AGENTS, composeRunMessage, invalidRunFields, fieldSchema } from "@/modules/agents/definitions";
import { niceTicks, parseChartSpec } from "@/modules/conversations/chart-spec";
import { cellNumber, hasTable, markdownToBlocks, tablesOf } from "@/modules/exports/blocks";
import { toCsv, toDocx, toPdf, toXlsx } from "@/modules/exports/server/render";

type Launch = Record<string, { name: string; fields?: Record<string, string>; options?: Record<string, Record<string, string>> }>;

describe("the 14 text agents", () => {
  it("are the launch set minus the two video agents (Step 8)", () => {
    expect(BUILTIN_AGENTS.map((a) => a.key).sort()).toEqual(
      LAUNCH_AGENTS.map((a) => a.key)
        .filter((k) => k !== "motion_design" && k !== "video_editor")
        .sort(),
    );
    for (const a of BUILTIN_AGENTS) expect(LAUNCH_AGENTS.find((l) => l.key === a.key)?.department).toBe(a.department);
  });

  it.each(BUILTIN_AGENTS.map((a) => [a.key, a] as const))("%s has a valid form, every text in French and English", (key, agent) => {
    for (const f of agent.fields) expect(fieldSchema.safeParse({ ...f, label: f.label }).success).toBe(true);
    if (agent.fields.some((f) => f.type === "files")) expect(agent.tools).toContain("attachments");
    for (const messages of [fr, en]) {
      const entry = (messages.tools.launch as Launch)[key];
      expect(entry.name).toBeTruthy();
      for (const f of agent.fields) {
        expect(entry.fields?.[f.key], `${key}.${f.key}`).toBeTruthy();
        for (const o of f.options ?? []) expect(entry.options?.[f.key]?.[o], `${key}.${f.key}.${o}`).toBeTruthy();
      }
      if (agent.notice) expect(messages.tools.notices[agent.notice]).toBeTruthy();
    }
  });

  it("respects the constraints of CLAUDE.md §4.7", () => {
    const review = BUILTIN_AGENTS.find((a) => a.key === "application_review")!;
    expect(review.notice).toBe("hiring");
    expect(review.instructions).toMatch(/never give a score, a grade, a ranking/);
    expect(review.instructions).toMatch(/a person reviews the applications and takes every decision/);
    for (const key of ["contract_review", "template_drafter"]) {
      const agent = BUILTIN_AGENTS.find((a) => a.key === key)!;
      expect(agent.notice).toBe("legal");
      expect(agent.instructions).toMatch(/not legal advice/);
    }
    for (const agent of BUILTIN_AGENTS) expect(agent.instructions).toMatch(/You never send, pay, sign or submit anything/);
    for (const key of ["invoice_intake", "payment_reminders", "cash_flow_forecast", "margin_analysis"]) expect(BUILTIN_AGENTS.find((a) => a.key === key)!.notice).toBe("draft");
    for (const key of ["cash_flow_forecast", "margin_analysis", "weekly_dashboard"]) expect(BUILTIN_AGENTS.find((a) => a.key === key)!.instructions).toContain(CHART_INSTRUCTION);
  });

  it("turns a filled form into the first message, with translated labels and options", () => {
    const agent = BUILTIN_AGENTS.find((a) => a.key === "payment_reminders")!;
    const values = { invoices: "Durand SARL, F-2026-104, 1 200 €, échéance 30/09", stage: "second", signature: "Claire" };
    expect(invalidRunFields(agent.fields, values)).toEqual([]);
    expect(invalidRunFields(agent.fields, { ...values, stage: "menace" })).toEqual(["stage"]);
    const launch = (fr.tools.launch as Launch).payment_reminders;
    const message = composeRunMessage(agent.fields, values, () => null, {
      field: (f) => launch.fields![f.key],
      option: (f, o) => launch.options![f.key][o],
      colon: " : ",
    });
    expect(message).toContain("Factures impayées (client, numéro, montant, échéance) :\nDurand SARL");
    expect(message).toContain("Relance : Deuxième relance (ferme)");
    expect(message).not.toContain("**");
  });
});

describe("charts in answers", () => {
  it("reads a valid spec and refuses anything else", () => {
    const spec = { type: "line", title: "Trésorerie", unit: "€", labels: ["Nov", "Déc"], series: [{ name: "Solde", values: [12000, 9500] }] };
    expect(parseChartSpec(JSON.stringify(spec))?.series[0].values).toEqual([12000, 9500]);
    expect(parseChartSpec(JSON.stringify({ ...spec, series: [{ name: "Solde", values: [1] }] }))).toBeNull();
    expect(parseChartSpec("not json")).toBeNull();
    expect(parseChartSpec(JSON.stringify({ ...spec, series: [1, 2, 3, 4].map((i) => ({ name: `S${i}`, values: [1, 2] })) }))).toBeNull();
  });

  it("uses clean axis ticks that include zero", () => {
    expect(niceTicks(1200, 9800)).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(niceTicks(-3000, 4000)[0]).toBeLessThanOrEqual(-3000);
    expect(niceTicks(-3000, 4000)).toContain(0);
  });
});

const ANSWER = [
  "# Prévision de trésorerie",
  "Hypothèses : **loyer** stable [S1].",
  "",
  "| Mois | Entrées | Sorties | Solde |",
  "|---|---:|---:|---:|",
  "| Novembre | 18 500 | 15 200,50 | 12 300 |",
  "| Décembre | 21 000 | 16 000 | 17 300 |",
  "",
  "- Point bas en **novembre**",
  "- À vérifier : la TVA",
  "",
  "```chart",
  '{"type":"line","title":"Solde","labels":["Nov","Déc"],"series":[{"name":"Solde","values":[12300,17300]}]}',
  "```",
].join("\n");

describe("exports", () => {
  const blocks = markdownToBlocks(ANSWER);

  it("reads headings, text, tables and lists, without citation marks; a chart becomes its table", () => {
    expect(blocks[0]).toEqual({ type: "heading", level: 1, inlines: [{ text: "Prévision de trésorerie" }] });
    expect(JSON.stringify(blocks)).not.toContain("[S1]");
    const tables = tablesOf(blocks);
    expect(tables).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual(["Novembre", "18 500", "15 200,50", "12 300"]);
    expect(tables[1]).toEqual({ type: "table", header: ["", "Solde"], rows: [["Nov", "12300"], ["Déc", "17300"]] });
    expect(hasTable(ANSWER)).toBe(true);
    expect(hasTable("Pas de tableau ici.")).toBe(false);
  });

  it("recognises numbers written the French or the English way", () => {
    expect(cellNumber("15 200,50")).toBe(15200.5);
    expect(cellNumber("1.234,5")).toBe(1234.5);
    expect(cellNumber("1,234.5")).toBe(1234.5);
    expect(cellNumber("1200 €")).toBe(1200);
    expect(cellNumber("F-2026-104")).toBeNull();
    expect(cellNumber("2026-09-30")).toBeNull();
  });

  it("writes a CSV that Excel opens with accents, semicolons for French", () => {
    const csv = toCsv(blocks, ";");
    expect(csv.startsWith("﻿Mois;Entrées;Sorties;Solde\r\n")).toBe(true);
    expect(csv).toContain("Novembre;18 500;15 200,50;12 300");
  });

  it("never lets a CSV cell run as a spreadsheet formula, and keeps negative numbers", () => {
    const csv = toCsv(markdownToBlocks("| A | B |\n|---|---|\n| =HYPERLINK(\"http://x\") | -8 950 € |\n| @SUM(1) | +33 6 12 |"), ";");
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")";-8 950 €`);
    expect(csv).toContain("'@SUM(1);'+33 6 12");
  });

  it("writes an Excel workbook with numbers as numbers", async () => {
    const buffer = await toXlsx(blocks, (i) => `Tableau ${i + 1}`);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(["Tableau 1", "Tableau 2"]);
    expect(book.worksheets[0].getCell("C2").value).toBe(15200.5);
    expect(book.worksheets[0].getCell("A2").value).toBe("Novembre");
  });

  it("writes Word and PDF files", async () => {
    const docx = await toDocx("Prévision", blocks);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    const pdf = await toPdf("Prévision de trésorerie — €", blocks);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
