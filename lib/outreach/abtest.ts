/**
 * Bayesian A/B testing for e-mail templates (reply rates).
 *
 * Each variant's reply rate gets a Beta(1 + replies, 1 + non-replies) posterior.
 * P(B > A) and the expected uplift are computed by Monte Carlo on the posteriors -
 * easy to explain ("there is a 96% chance that B gets more replies than A") and valid
 * at any sample size, unlike a p-value that is only meaningful at a pre-planned stop.
 * Thompson sampling uses the same posteriors to split new sends: better variants get
 * more traffic while uncertainty remains.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marsaglia-Tsang gamma sampler (shape >= 1 after boosting) */
function gamma(shape: number, rnd: () => number): number {
  if (shape < 1) return gamma(shape + 1, rnd) * Math.pow(rnd(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = Math.max(rnd(), 1e-12);
      const u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(a: number, b: number, rnd: () => number) {
  const x = gamma(a, rnd);
  const y = gamma(b, rnd);
  return x / (x + y);
}

export interface VariantStats { variant: string; sent: number; replied: number }

export interface AbResult {
  /** low/high = 90% credible interval; expectedLoss = E[max_k θ_k − θ_v], in reply-rate units */
  variants: (VariantStats & { rate: number; low: number; high: number; pBest: number; expectedLoss: number })[];
  probBBeatsA: number | null;
  expectedUplift: number | null; // relative, B vs A
  verdict: string;
  decided: boolean;
  winner: string | null;
}

/** Stop the test once the expected loss of the leader is below half a percentage point. */
export const LOSS_TOLERANCE = 0.005;

export function analyzeAb(stats: VariantStats[], draws = 20000, seed = 7): AbResult {
  const rnd = mulberry32(seed);
  const samples = stats.map((s) => {
    const arr = new Float64Array(draws);
    for (let i = 0; i < draws; i++) arr[i] = sampleBeta(1 + s.replied, 1 + Math.max(0, s.sent - s.replied), rnd);
    return arr;
  });
  const wins = new Array(stats.length).fill(0);
  const loss = new Array(stats.length).fill(0);
  for (let i = 0; i < draws; i++) {
    let best = 0;
    for (let k = 1; k < stats.length; k++) if (samples[k][i] > samples[best][i]) best = k;
    wins[best]++;
    // expected loss: how many reply-rate points we give up by committing to variant k
    for (let k = 0; k < stats.length; k++) loss[k] += samples[best][i] - samples[k][i];
  }
  const quant = (arr: Float64Array, q: number) => {
    const s = Array.from(arr).sort((x, y) => x - y);
    return s[Math.floor(q * (s.length - 1))];
  };
  const variants = stats.map((s, k) => ({
    ...s,
    rate: s.sent ? s.replied / s.sent : 0,
    low: quant(samples[k], 0.05),
    high: quant(samples[k], 0.95),
    pBest: wins[k] / draws,
    expectedLoss: loss[k] / draws,
  }));
  let probBBeatsA: number | null = null;
  let expectedUplift: number | null = null;
  const ia = stats.findIndex((s) => s.variant === "A");
  const ib = stats.findIndex((s) => s.variant === "B");
  if (ia >= 0 && ib >= 0) {
    let n = 0;
    let up = 0;
    for (let i = 0; i < draws; i++) {
      if (samples[ib][i] > samples[ia][i]) n++;
      up += samples[ib][i] / samples[ia][i] - 1;
    }
    probBBeatsA = n / draws;
    expectedUplift = up / draws;
  }
  const best = variants.reduce((p, c) => (c.pBest > p.pBest ? c : p), variants[0]);
  const minSent = Math.min(...stats.map((s) => s.sent));
  // Decision rule: stop when committing to the leader costs less than LOSS_TOLERANCE reply-rate points
  // in expectation (Stucchio's expected-loss criterion), or when it is best with >= 95% probability.
  const decided = !!best && minSent >= 20 && (best.expectedLoss < LOSS_TOLERANCE || best.pBest >= 0.95);
  const verdict = !best ? "No data yet"
    : minSent < 20 ? "Too early: send at least 20 e-mails per variant"
    : decided ? `Variant ${best.variant} wins (${Math.round(best.pBest * 100)}% probability of being best; choosing it risks only ${(best.expectedLoss * 100).toFixed(2)} reply-rate points)`
    : best.pBest >= 0.8 ? `Variant ${best.variant} is likely better (${Math.round(best.pBest * 100)}%) - keep testing to be sure`
    : "No clear winner yet - keep testing";
  return { variants, probBBeatsA, expectedUplift, verdict, decided, winner: decided ? best.variant : null };
}

function lnGamma(z: number): number {
  // Lanczos approximation (g = 7, n = 9), accurate to ~1e-15 for z > 0
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Density of Beta(a, b) at x - used to draw the posterior curves. */
export function betaPdf(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lnGamma(a) + lnGamma(b) - lnGamma(a + b)));
}

/** Posterior curves for a set of variants on a common grid, for charting. */
export function posteriorCurves(stats: VariantStats[], points = 120) {
  const hi = Math.min(1, Math.max(0.1, ...stats.map((s) => (s.sent ? (s.replied + 1) / (s.sent + 2) : 0.5) * 2.2)));
  return Array.from({ length: points + 1 }, (_, i) => {
    const x = (hi * i) / points;
    const row: Record<string, number> = { x };
    for (const s of stats) row[s.variant] = betaPdf(x, 1 + s.replied, 1 + Math.max(0, s.sent - s.replied));
    return row;
  });
}

/** Thompson sampling: choose a variant for each of n new e-mails. */
export function thompsonAllocate(stats: VariantStats[], n: number, seed = Date.now()): string[] {
  const rnd = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestDraw = -1;
    stats.forEach((s, k) => {
      const d = sampleBeta(1 + s.replied, 1 + Math.max(0, s.sent - s.replied), rnd);
      if (d > bestDraw) {
        bestDraw = d;
        best = k;
      }
    });
    out.push(stats[best].variant);
  }
  return out;
}
