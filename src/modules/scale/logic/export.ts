/** CSV for spreadsheets: quoted cells, a byte-order mark so Excel reads accents, cells starting with = + - @ made inert. */
export function toCsvRows(rows: Record<string, unknown>[], separator: ";" | ","): string {
  if (!rows.length) return "﻿";
  const headers = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return "﻿" + [headers.map(cell).join(separator), ...rows.map((r) => headers.map((h) => cell(r[h])).join(separator))].join("\r\n") + "\r\n";
}
