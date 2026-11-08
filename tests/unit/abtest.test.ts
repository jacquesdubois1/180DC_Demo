import { describe, expect, it } from "vitest";
import { analyzeAb, betaPdf, posteriorCurves, thompsonAllocate } from "@/lib/outreach/abtest";

describe("Bayesian A/B test on reply rates", () => {
  it("declares a winner when the difference is clear", () => {
    const r = analyzeAb([{ variant: "A", sent: 200, replied: 20 }, { variant: "B", sent: 200, replied: 50 }]);
    expect(r.probBBeatsA).toBeGreaterThan(0.99);
    expect(r.decided).toBe(true);
    expect(r.winner).toBe("B");
    const b = r.variants.find((v) => v.variant === "B")!;
    expect(b.low).toBeLessThan(0.25);
    expect(b.high).toBeGreaterThan(0.25);
    expect(b.expectedLoss).toBeLessThan(0.001);
  });

  it("keeps testing when variants are indistinguishable", () => {
    const r = analyzeAb([{ variant: "A", sent: 150, replied: 30 }, { variant: "B", sent: 150, replied: 31 }]);
    expect(r.probBBeatsA).toBeGreaterThan(0.35);
    expect(r.probBBeatsA).toBeLessThan(0.75);
    expect(r.decided).toBe(false);
  });

  it("refuses to decide on tiny samples", () => {
    const r = analyzeAb([{ variant: "A", sent: 8, replied: 0 }, { variant: "B", sent: 8, replied: 4 }]);
    expect(r.decided).toBe(false);
    expect(r.verdict).toMatch(/Too early/);
  });

  it("Thompson sampling sends most traffic to the better variant but keeps exploring", () => {
    const plan = thompsonAllocate([{ variant: "A", sent: 60, replied: 6 }, { variant: "B", sent: 60, replied: 15 }], 1000, 3);
    const b = plan.filter((v) => v === "B").length;
    expect(b).toBeGreaterThan(850);
    expect(b).toBeLessThan(1000);
  });

  it("posterior densities integrate to 1", () => {
    const curve = posteriorCurves([{ variant: "A", sent: 80, replied: 12 }], 400);
    const dx = curve[1].x - curve[0].x;
    expect(curve.reduce((s, r) => s + r.A * dx, 0)).toBeCloseTo(1, 2);
    expect(betaPdf(0.5, 1, 1)).toBeCloseTo(1, 10);
  });
});
