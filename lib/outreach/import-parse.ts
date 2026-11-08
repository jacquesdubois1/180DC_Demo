import "server-only";
import ExcelJS from "exceljs";

export const MAX_IMPORT_ROWS = 2000;

/** RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF; delimiter sniffed from the header (, ; or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? undefined : src.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows; // empty lines are kept so row numbers match the file; callers skip them
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("hyperlink" in v) return String((v as { text?: unknown }).text ?? v.hyperlink);
    if ("result" in v) return v.result === undefined || v.result === null ? "" : String(v.result);
    if ("error" in v) return "";
  }
  return String(v);
}

export interface ParsedRow { rowNumber: number; values: Record<string, string> }

/** First worksheet -> header row + records keyed by header, with the row numbers people see in Excel. */
export async function parseSpreadsheet(bytes: Buffer, filename: string): Promise<{ headers: string[]; rows: ParsedRow[]; truncated: boolean }> {
  let matrix: { n: number; cells: string[] }[];
  if (/\.(csv|tsv|txt)$/i.test(filename)) {
    matrix = parseCsv(bytes.toString("utf8")).map((cells, i) => ({ n: i + 1, cells }));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) return { headers: [], rows: [], truncated: false };
    matrix = [];
    ws.eachRow({ includeEmpty: false }, (r, rowNumber) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.actualColumnCount; c++) cells.push(cellText(r.getCell(c).value).trim());
      matrix.push({ n: rowNumber, cells });
    });
  }
  matrix = matrix.filter((r) => r.cells.some((v) => v.trim() !== ""));
  const headerIdx = matrix.findIndex((r) => r.cells.filter((v) => v.trim()).length >= 2);
  if (headerIdx < 0) return { headers: [], rows: [], truncated: false };
  const seen = new Map<string, number>();
  const headers = matrix[headerIdx].cells.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k > 1 ? `${base} (${k})` : base;
  });
  const body = matrix.slice(headerIdx + 1);
  const rows = body.slice(0, MAX_IMPORT_ROWS).map((r) => ({ rowNumber: r.n, values: Object.fromEntries(headers.map((h, i) => [h, (r.cells[i] ?? "").trim()])) }));
  return { headers, rows, truncated: body.length > MAX_IMPORT_ROWS };
}
