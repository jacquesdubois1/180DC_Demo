/** Tiny SQL literal builder for the seed file (values are generated, never user input). */

export type Raw = { raw: string };
export type V = string | number | boolean | null | undefined | Raw | string[] | Record<string, unknown> | unknown[];

export const raw = (s: string): Raw => ({ raw: s });
/** timestamp relative to the moment the seed is loaded, so demo data never goes stale */
export const ago = (days: number, hours = 0) => raw(`now() - interval '${Math.round(days * 24 + hours)} hours'`);
export const ahead = (days: number, hours = 0) => raw(`now() + interval '${Math.round(days * 24 + hours)} hours'`);
export const dateAgo = (days: number) => raw(`current_date - ${Math.round(days)}`);
export const dateAhead = (days: number) => raw(`current_date + ${Math.round(days)}`);

const str = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function lit(v: V): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return v.length ? `ARRAY[${v.map((x) => str(x as string)).join(",")}]` : "'{}'";
    return `${str(JSON.stringify(v))}::jsonb`;
  }
  if (typeof v === "object" && "raw" in v && typeof (v as Raw).raw === "string" && Object.keys(v).length === 1) {
    return (v as Raw).raw;
  }
  return `${str(JSON.stringify(v))}::jsonb`;
}

export function insert(table: string, rows: Record<string, V>[], chunk = 200): string {
  if (!rows.length) return "";
  // union of all keys; a key missing in a row becomes DEFAULT (keeps column defaults intact)
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((r) => `(${cols.map((c) => (c in r && r[c] !== undefined ? lit(r[c]) : "DEFAULT")).join(", ")})`)
      .join(",\n  ");
    out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n  ${values};`);
  }
  return out.join("\n") + "\n";
}

/** explicit jsonb literal (use for every jsonb column) */
export const json = (v: unknown): Raw => raw(`${str(JSON.stringify(v))}::jsonb`);
/** bytea literal from a buffer */
export const bytea = (b: Buffer): Raw => raw(`'\\x${b.toString("hex")}'::bytea`);
