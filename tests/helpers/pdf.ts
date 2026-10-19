/** Smallest valid PDF with one line of text per page (built by hand, offsets computed). */
export function minimalPdf(...lines: string[]): Uint8Array {
  const pageIds = lines.map((_, i) => 3 + i * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`,
  ];
  const fontId = 3 + lines.length * 2;
  lines.forEach((line, i) => {
    const contentId = pageIds[i] + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    const stream = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
