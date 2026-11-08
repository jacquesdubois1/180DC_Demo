/**
 * Entity resolution for prospect imports: normalise, block, compare, decide.
 * Mirrors the SQL functions app.normalize_org_name / app.extract_domain so that
 * the import preview and the database agree.
 */

const LEGAL = /\b(s l u|s l|slu|sl|s a|sa|sau|gmbh|ag|ltd|limited|inc|llc|sas|sarl|bv|nv|plc|corp|co|scp|sccl|coop)\b/g;
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es", "live.com", "yahoo.com",
  "yahoo.es", "icloud.com", "me.com", "gmx.de", "gmx.net", "web.de", "proton.me", "protonmail.com", "aol.com"]);

export function fold(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function normalizeOrgName(name: string | null | undefined): string {
  if (!name) return "";
  return fold(name).replace(/[^a-z0-9 ]+/g, " ").replace(LEGAL, " ").replace(/\s+/g, " ").trim();
}

export function extractDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.trim().replace(/^.*@/, "").replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/[/?#:].*$/, "").toLowerCase();
  if (!d || !d.includes(".")) return null;
  return FREE_MAIL.has(d) ? null : d;
}

/** Jaro-Winkler similarity in [0, 1] - robust for short names with typos/abbreviations */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export interface Candidate { id: string; normalized: string; domain: string | null }
export type MatchStatus = "duplicate" | "possible_duplicate" | "new";

/** Decide whether an incoming organisation already exists. */
export function matchOrganization(row: { name: string; domain: string | null }, existing: Candidate[]) {
  const n = normalizeOrgName(row.name);
  if (row.domain) {
    const byDomain = existing.find((e) => e.domain === row.domain);
    if (byDomain) return { status: "duplicate" as MatchStatus, id: byDomain.id, similarity: 1, reason: `same domain ${row.domain}` };
  }
  let best: Candidate | null = null;
  let bestSim = 0;
  for (const e of existing) {
    if (!e.normalized || !n) continue;
    if (e.normalized[0] !== n[0] && !e.normalized.includes(n.split(" ")[0])) continue; // blocking: cheap pre-filter
    const sim = jaroWinkler(n, e.normalized);
    if (sim > bestSim) {
      bestSim = sim;
      best = e;
    }
  }
  // only an identical normalised name is a sure duplicate: short names with a long common prefix
  // ("Kidsnet" / "Kidsnest") score above 0.97 and must not be merged automatically
  if (best && best.normalized === n) return { status: "duplicate" as MatchStatus, id: best.id, similarity: 1, reason: "same name" };
  if (best && bestSim >= 0.88) return { status: "possible_duplicate" as MatchStatus, id: best.id, similarity: bestSim, reason: `similar name (${Math.round(bestSim * 100)}%)` };
  return { status: "new" as MatchStatus, id: null, similarity: bestSim, reason: null };
}
