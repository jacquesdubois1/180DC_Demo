/**
 * Reviewer calibration ("who is a harsh grader?").
 *
 * Model (additive two-way random effects, estimated by penalised alternating least squares):
 *
 *     score[a, r] = mu + theta[a] + beta[r] + e,     e ~ N(0, sigma^2)
 *
 *   theta[a]  candidate quality (what we actually want to rank on)
 *   beta[r]   reviewer severity: negative = harsher than average, positive = more lenient
 *
 * Because every candidate is scored by different reviewers, the raw average mixes the
 * candidate's quality with WHO happened to review them. Estimating beta from the whole
 * cycle (reviewers overlap across many candidates) lets us remove that luck-of-the-draw.
 * Ridge penalties (lambda) shrink estimates for reviewers/candidates with little data
 * towards zero - the same idea as empirical Bayes / random effects.
 */

export interface ScoreObs {
  applicationId: string;
  reviewerId: string;
  score: number; // weighted mean of the criteria, 1..5
}

export interface CalibrationResult {
  mu: number;
  sigma: number;
  iterations: number;
  reviewerVarianceShare: number; // share of score variance explained by reviewer severity
  reviewers: { reviewerId: string; severity: number; se: number; n: number; rawMean: number }[];
  candidates: {
    applicationId: string;
    n: number;
    rawMean: number;
    calibrated: number;
    se: number;
    rankRaw: number;
    rankCalibrated: number;
    disagreement: number; // max - min of the raw scores
  }[];
}

export function calibrate(obs: ScoreObs[], opts: { lambdaReviewer?: number; lambdaCandidate?: number; maxIter?: number } = {}): CalibrationResult {
  const lr = opts.lambdaReviewer ?? 2;
  const lc = opts.lambdaCandidate ?? 0.5;
  const maxIter = opts.maxIter ?? 200;
  const apps = [...new Set(obs.map((o) => o.applicationId))];
  const revs = [...new Set(obs.map((o) => o.reviewerId))];
  const ai = new Map(apps.map((a, i) => [a, i]));
  const ri = new Map(revs.map((r, i) => [r, i]));
  const A = obs.map((o) => ai.get(o.applicationId)!);
  const R = obs.map((o) => ri.get(o.reviewerId)!);
  const y = obs.map((o) => o.score);
  const n = obs.length;
  if (!n) {
    return { mu: 0, sigma: 0, iterations: 0, reviewerVarianceShare: 0, reviewers: [], candidates: [] };
  }

  let mu = y.reduce((s, v) => s + v, 0) / n;
  const theta = new Float64Array(apps.length);
  const beta = new Float64Array(revs.length);
  const nA = new Float64Array(apps.length);
  const nR = new Float64Array(revs.length);
  for (let k = 0; k < n; k++) {
    nA[A[k]]++;
    nR[R[k]]++;
  }

  let it = 0;
  for (; it < maxIter; it++) {
    let delta = 0;
    // candidates
    const sumA = new Float64Array(apps.length);
    for (let k = 0; k < n; k++) sumA[A[k]] += y[k] - mu - beta[R[k]];
    for (let a = 0; a < apps.length; a++) {
      const v = sumA[a] / (nA[a] + lc);
      delta = Math.max(delta, Math.abs(v - theta[a]));
      theta[a] = v;
    }
    // reviewers
    const sumR = new Float64Array(revs.length);
    for (let k = 0; k < n; k++) sumR[R[k]] += y[k] - mu - theta[A[k]];
    for (let r = 0; r < revs.length; r++) {
      const v = sumR[r] / (nR[r] + lr);
      delta = Math.max(delta, Math.abs(v - beta[r]));
      beta[r] = v;
    }
    // identification: severities are relative to the average reviewer (weighted by volume)
    let mb = 0;
    for (let r = 0; r < revs.length; r++) mb += beta[r] * nR[r];
    mb /= n;
    for (let r = 0; r < revs.length; r++) beta[r] -= mb;
    // grand mean
    let s = 0;
    for (let k = 0; k < n; k++) s += y[k] - theta[A[k]] - beta[R[k]];
    const newMu = s / n;
    delta = Math.max(delta, Math.abs(newMu - mu));
    mu = newMu;
    if (delta < 1e-7) break;
  }

  let rss = 0;
  const resid = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    resid[k] = y[k] - mu - theta[A[k]] - beta[R[k]];
    rss += resid[k] ** 2;
  }
  const dof = Math.max(1, n - apps.length - revs.length);
  const sigma = Math.sqrt(rss / dof);
  const varY = y.reduce((s, v) => s + (v - mu) ** 2, 0) / n;
  const betaPerObs = R.map((r) => beta[r]);
  const varBeta = betaPerObs.reduce((s, v) => s + v * v, 0) / n;

  const rawByApp = new Map<number, number[]>();
  const rawByRev = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    (rawByApp.get(A[k]) ?? rawByApp.set(A[k], []).get(A[k])!).push(y[k]);
    (rawByRev.get(R[k]) ?? rawByRev.set(R[k], []).get(R[k])!).push(y[k]);
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

  const candidates = apps.map((id, a) => {
    const raw = rawByApp.get(a)!;
    return {
      applicationId: id,
      n: raw.length,
      rawMean: mean(raw),
      calibrated: mu + theta[a],
      se: sigma / Math.sqrt(nA[a] + lc),
      rankRaw: 0,
      rankCalibrated: 0,
      disagreement: Math.max(...raw) - Math.min(...raw),
    };
  });
  [...candidates].sort((p, q) => q.rawMean - p.rawMean).forEach((c, i) => (c.rankRaw = i + 1));
  [...candidates].sort((p, q) => q.calibrated - p.calibrated).forEach((c, i) => (c.rankCalibrated = i + 1));

  return {
    mu,
    sigma,
    iterations: it + 1,
    reviewerVarianceShare: varY > 0 ? varBeta / varY : 0,
    reviewers: revs.map((id, r) => ({ reviewerId: id, severity: beta[r], se: sigma / Math.sqrt(nR[r] + lr), n: nR[r], rawMean: mean(rawByRev.get(r)!) })),
    candidates,
  };
}

/** Weighted mean of criterion scores for one review (weights from the rubric). */
export function reviewScore(scores: Record<string, number>, weights: Record<string, number>): number | null {
  let s = 0;
  let w = 0;
  for (const [k, v] of Object.entries(scores)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const wt = weights[k] ?? 1;
    s += v * wt;
    w += wt;
  }
  return w > 0 ? s / w : null;
}
