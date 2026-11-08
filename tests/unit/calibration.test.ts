import { describe, expect, it } from "vitest";
import { calibrate, type ScoreObs } from "@/lib/analytics/calibration";
import { mulberry32 } from "@/scripts/seed/random";

function pearson(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  a.forEach((x, i) => { num += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return num / Math.sqrt(da * db);
}

describe("reviewer calibration (score = mu + theta + beta + e)", () => {
  // synthetic cycle with a known truth: 80 candidates, 8 reviewers of different severity, 3 reviews each
  const rnd = mulberry32(42);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
  const severity = [-0.7, -0.4, -0.2, 0, 0.1, 0.3, 0.5, 0.6];
  const quality = Array.from({ length: 80 }, () => 0.6 * gauss());
  const obs: ScoreObs[] = [];
  quality.forEach((q, a) => {
    const picked = new Set<number>();
    while (picked.size < 3) picked.add(Math.floor(rnd() * severity.length));
    for (const r of picked) obs.push({ applicationId: `a${a}`, reviewerId: `r${r}`, score: 3 + q + severity[r] + 0.25 * gauss() });
  });
  const result = calibrate(obs);

  it("recovers who grades harshly and who leniently", () => {
    const est = severity.map((_, r) => result.reviewers.find((x) => x.reviewerId === `r${r}`)!.severity);
    expect(pearson(est, severity)).toBeGreaterThan(0.95);
    expect(est[0]).toBeLessThan(est[7]); // the harshest really is estimated harsher than the most lenient
  });

  it("ranks candidates closer to their true quality than the raw average does", () => {
    const byId = new Map(result.candidates.map((c) => [c.applicationId, c]));
    const raw = quality.map((_, a) => byId.get(`a${a}`)!.rawMean);
    const cal = quality.map((_, a) => byId.get(`a${a}`)!.calibrated);
    expect(pearson(cal, quality)).toBeGreaterThan(pearson(raw, quality));
  });

  it("attributes a meaningful share of the variance to reviewers", () => {
    expect(result.reviewerVarianceShare).toBeGreaterThan(0.1);
    expect(result.reviewerVarianceShare).toBeLessThan(0.9);
  });
});
