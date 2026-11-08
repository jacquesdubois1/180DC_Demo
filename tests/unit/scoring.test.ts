import { describe, expect, it } from "vitest";
import { type ClosedLead, fitBand, fitScore, type IcpCriteria, isotonicDecreasing, learnRates, reachedStages, winProbability } from "@/lib/outreach/scoring";

const icp: IcpCriteria = {
  sectors: { Education: 1, "Culture & arts": 0.5 },
  org_types: { ngo: 1, company: 0.5 },
  size_bands: { "11-50": 1 },
  cities: { Barcelona: 1 },
  weights: { sector: 0.35, org_type: 0.25, size: 0.15, location: 0.15, alumni: 0.1 },
};

describe("fit score", () => {
  it("gives 100 to the ideal client and explains every point", () => {
    const f = fitScore({ sector: "Education", orgType: "ngo", sizeBand: "11-50", city: "Barcelona", alumniContact: true }, icp);
    expect(f.score).toBe(100);
    expect(Object.values(f.parts).reduce((s, x) => s + x, 0)).toBeCloseTo(100, 0);
    expect(fitBand(f.score)).toBe("A");
  });
  it("uses neutral defaults for unknown values", () => {
    const f = fitScore({ sector: null, orgType: null, sizeBand: null, city: null, alumniContact: false }, icp);
    expect(f.score).toBeGreaterThan(20);
    expect(f.score).toBeLessThan(50);
  });
});

describe("stage history", () => {
  it("does not treat a follow-up e-mail as a step every signed lead went through", () => {
    expect(reachedStages("won", [])).not.toContain("follow_up");
    expect(reachedStages("follow_up", [])).toEqual(["new", "contacted", "follow_up"]);
    expect(reachedStages("meeting", ["contacted", "follow_up", "replied"])).toContain("follow_up");
  });
});

describe("learned win rates", () => {
  it("shrinks small groups towards the overall rate (empirical Bayes)", () => {
    const closed: ClosedLead[] = [
      ...Array.from({ length: 40 }, (_, i) => ({ band: "A", outcome: i < 8 ? "won" : "lost", reached: ["new", "contacted"] }) as ClosedLead),
      { band: "C", outcome: "won", reached: ["new", "contacted"] }, // one lucky lead must not make band C the best
    ];
    const r = learnRates(closed);
    expect(r.overall).toBeCloseTo(9 / 41, 5);
    expect(r.band.C).toBeLessThanOrEqual(r.band.A);
    expect(winProbability("won", "A", r)).toBe(1);
    expect(winProbability("lost", "A", r)).toBe(0);
  });

  it("isotonic regression returns the closest non-increasing sequence", () => {
    expect(isotonicDecreasing([0.3, 0.1, 0.4, 0.05], [50, 40, 10, 5]).map((x) => +x.toFixed(3))).toEqual([0.3, 0.16, 0.16, 0.05]);
    expect(isotonicDecreasing([0.5, 0.4, 0.3], [1, 1, 1])).toEqual([0.5, 0.4, 0.3]);
  });
});
