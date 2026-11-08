/**
 * Krippendorff's alpha (interval metric) - inter-rater reliability for scorecards.
 *
 *   alpha = 1 - D_observed / D_expected
 *
 * D_observed: average squared disagreement between reviewers of the SAME candidate
 * D_expected: average squared difference between ANY two scores in the data
 * 1 = perfect agreement, 0 = no better than chance, < 0 = systematic disagreement.
 * Handles any number of reviewers per candidate and missing reviews.
 * Rule of thumb (Krippendorff 2004): >= 0.8 reliable, 0.667-0.8 tentative, below: rubric unclear.
 */
export function krippendorffAlphaInterval(units: number[][]): { alpha: number; nUnits: number; nValues: number } {
  const pairable = units.filter((u) => u.filter(Number.isFinite).length >= 2).map((u) => u.filter(Number.isFinite));
  const n = pairable.reduce((s, u) => s + u.length, 0);
  if (n < 2) return { alpha: Number.NaN, nUnits: pairable.length, nValues: n };

  // sum over ordered pairs i != j of (v_i - v_j)^2 = 2 m sum(v^2) - 2 (sum v)^2
  const pairSum = (v: number[]) => {
    let s1 = 0;
    let s2 = 0;
    for (const x of v) {
      s1 += x;
      s2 += x * x;
    }
    return 2 * v.length * s2 - 2 * s1 * s1;
  };
  let dO = 0;
  for (const u of pairable) dO += pairSum(u) / (u.length - 1);
  dO /= n;
  const all = pairable.flat();
  const dE = pairSum(all) / (n * (n - 1));
  return { alpha: dE === 0 ? 1 : 1 - dO / dE, nUnits: pairable.length, nValues: n };
}

export function alphaLabel(alpha: number) {
  if (!Number.isFinite(alpha)) return "not enough data";
  if (alpha >= 0.8) return "reliable";
  if (alpha >= 0.667) return "tentative";
  if (alpha >= 0.4) return "weak - clarify the rubric anchors";
  return "poor - reviewers interpret this criterion differently";
}
