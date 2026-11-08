/**
 * Lead scoring in two transparent layers.
 *
 * 1. Fit score (0-100): how well an organisation matches the ideal-customer profile (ICP)
 *    configured by Client Relations - a weighted sum of sector, organisation type, size,
 *    location and an Esade-alumni connection. Every point is explainable.
 * 2. Probabilities learned from our own history (empirical Bayes):
 *    reply rate and win rate per fit band, shrunk towards the overall rate so small bands
 *    do not produce extreme numbers. They update automatically as outcomes come in.
 *    Expected value of a lead = P(win) - used to prioritise and to forecast the pipeline.
 */

export interface IcpCriteria {
  sectors: Record<string, number>;
  org_types: Record<string, number>;
  size_bands: Record<string, number>;
  cities: Record<string, number>;
  weights: { sector: number; org_type: number; size: number; location: number; alumni: number };
}

export interface LeadFeatures {
  sector: string | null;
  orgType: string | null;
  sizeBand: string | null;
  city: string | null;
  alumniContact: boolean;
}

export function fitScore(f: LeadFeatures, icp: IcpCriteria) {
  const w = icp.weights;
  const parts = {
    sector: (f.sector ? icp.sectors[f.sector] ?? 0.4 : 0.4) * w.sector,
    org_type: (f.orgType ? icp.org_types[f.orgType] ?? 0.3 : 0.3) * w.org_type,
    size: (f.sizeBand ? icp.size_bands[f.sizeBand] ?? 0.5 : 0.5) * w.size,
    location: (f.city ? icp.cities[f.city] ?? 0.3 : 0.3) * w.location,
    alumni: (f.alumniContact ? 1 : 0) * w.alumni,
  };
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  const score = (Object.values(parts).reduce((s, x) => s + x, 0) / total) * 100;
  return { score: Math.round(score * 10) / 10, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10])) };
}

export function fitBand(score: number) {
  return score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D";
}

export interface ClosedLead { band: string; outcome: "won" | "lost" | "not_interested"; reached: string[] }

// The main ladder. "follow_up" is a side step (a reminder e-mail), not a prerequisite for a reply,
// so it is never implied - a lead counts as having reached it only if its history says so.
const LADDER = ["new", "contacted", "replied", "meeting", "proposal", "won"];
const ORDER = ["new", "contacted", "follow_up", "replied", "meeting", "proposal", "won"];

/** Stages a lead passed through (from its history, or a conservative guess when there is none). */
export function reachedStages(finalStage: string, history: string[]): string[] {
  const seen = new Set(history);
  seen.add(finalStage);
  if (finalStage === "lost" && !history.length) ["new", "contacted", "replied", "meeting"].forEach((s) => seen.add(s));
  if (finalStage === "not_interested" && !history.length) ["new", "contacted", "replied"].forEach((s) => seen.add(s));
  // reaching a stage implies having reached the earlier rungs of the ladder
  const max = Math.max(...[...seen].map((s) => (s === "follow_up" ? LADDER.indexOf("contacted") : LADDER.indexOf(s))));
  LADDER.slice(0, max + 1).forEach((s) => seen.add(s));
  return ORDER.filter((s) => seen.has(s)).concat([...seen].filter((s) => !ORDER.includes(s)));
}

/**
 * Win rates learned from closed leads, with empirical-Bayes shrinkage (k pseudo-observations
 * of the overall rate) so that sparse cells do not produce 0% or 100%.
 *   stage[s]  P(signed | reached stage s)
 *   band[b]   relative lift of fit band b versus the average lead
 */
export function learnRates(closed: ClosedLead[], k = 5) {
  const overall = closed.length ? closed.filter((c) => c.outcome === "won").length / closed.length : 0.3;
  const stage: Record<string, number> = {};
  for (const s of ORDER.slice(0, 6)) {
    const pool = closed.filter((c) => c.reached.includes(s));
    stage[s] = (pool.filter((c) => c.outcome === "won").length + k * overall) / (pool.length + k);
  }
  stage.on_hold = stage.contacted;
  // Fit bands: shrunk rates, then made monotone (a better fit must never predict a lower win
  // rate) with weighted isotonic regression - small, noisy bands get pooled with their neighbours.
  const bands = ["A", "B", "C", "D"];
  const raw = bands.map((b) => {
    const pool = closed.filter((c) => c.band === b);
    return { rate: (pool.filter((c) => c.outcome === "won").length + k * overall) / (pool.length + k), weight: pool.length + k };
  });
  const mono = isotonicDecreasing(raw.map((r) => r.rate), raw.map((r) => r.weight));
  const band: Record<string, number> = {};
  bands.forEach((b, i) => (band[b] = overall > 0 ? mono[i] / overall : 1));
  return { overall, stage, band, nClosed: closed.length };
}

/** Pool-adjacent-violators: the closest non-increasing sequence (weighted least squares). */
export function isotonicDecreasing(values: number[], weights: number[]): number[] {
  const blocks: { sum: number; w: number; n: number }[] = [];
  values.forEach((v, i) => {
    blocks.push({ sum: v * weights[i], w: weights[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w >= b.sum / b.w) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  });
  return blocks.flatMap((b) => Array(b.n).fill(b.sum / b.w));
}

/** Probability that an open lead gets signed. */
export function winProbability(stage: string, band: string, rates: ReturnType<typeof learnRates>) {
  if (stage === "won") return 1;
  if (stage === "lost" || stage === "not_interested") return 0;
  const p = (rates.stage[stage] ?? rates.overall) * (rates.band[band] ?? 1);
  return Math.max(0.01, Math.min(0.99, p));
}
