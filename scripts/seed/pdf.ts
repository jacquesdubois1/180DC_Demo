/**
 * Minimal one-page PDF writer (Helvetica, WinAnsi) for fake demo CVs.
 * Real CVs are uploaded by applicants; these exist so the demo has something to open.
 */

function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code >= 32 && code < 127) out += ch;
    else if (code >= 160 && code <= 255) out += "\\" + code.toString(8).padStart(3, "0");
    else if (ch === "–" || ch === "—") out += "-";
    else if (ch === "•") out += "\\225";
    else out += "?";
  }
  return out;
}

export interface CvSection {
  title: string;
  lines: string[];
}

export function makeCvPdf(name: string, subtitle: string, sections: CvSection[]): Buffer {
  const ops: string[] = [];
  let y = 790;
  ops.push(`BT /F2 20 Tf 56 ${y} Td (${toWinAnsi(name)}) Tj ET`);
  y -= 20;
  ops.push(`BT /F1 10 Tf 56 ${y} Td (${toWinAnsi(subtitle)}) Tj ET`);
  y -= 14;
  ops.push(`0.12 0.42 0.27 RG 1.2 w 56 ${y} m 539 ${y} l S`);
  y -= 24;
  for (const s of sections) {
    ops.push(`BT /F2 12 Tf 0.12 0.42 0.27 rg 56 ${y} Td (${toWinAnsi(s.title.toUpperCase())}) Tj ET`);
    y -= 16;
    for (const line of s.lines) {
      ops.push(`BT /F1 10 Tf 0 0 0 rg 56 ${y} Td (${toWinAnsi(line)}) Tj ET`);
      y -= 14;
    }
    y -= 10;
  }
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
