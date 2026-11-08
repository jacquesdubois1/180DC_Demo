import { describe, expect, it } from "vitest";
import { type AssignInput, optimizeAssignment } from "@/lib/analytics/assignment";

const reviewers = [
  { id: "r1", capacity: 10, currentLoad: 0, expertise: ["p1"], senior: true },
  { id: "r2", capacity: 10, currentLoad: 4, expertise: ["p2"], senior: false },
  { id: "r3", capacity: 6, currentLoad: 0, expertise: ["p1", "p2"], senior: false },
  { id: "r4", capacity: 10, currentLoad: 0, expertise: [], senior: true },
];
const apps = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, positionId: i % 2 ? "p1" : "p2", needed: 2, alreadyAssigned: [] as string[] }));

describe("reviewer assignment (integer linear program)", () => {
  it("covers every application, respects conflicts, capacity and seniority", async () => {
    const input: AssignInput = { apps, reviewers, conflicts: [{ reviewerId: "r1", applicationId: "a0" }], requireSenior: true };
    const r = await optimizeAssignment(input);
    expect(r.method).toBe("ilp");
    expect(r.shortages).toEqual([]);
    for (const a of apps) {
      const who = r.pairs.filter((p) => p.applicationId === a.id).map((p) => p.reviewerId);
      expect(new Set(who).size).toBe(2);
      expect(who.some((id) => reviewers.find((x) => x.id === id)!.senior)).toBe(true);
    }
    expect(r.pairs.some((p) => p.applicationId === "a0" && p.reviewerId === "r1")).toBe(false);
    for (const l of r.loads) expect(l.after).toBeLessThanOrEqual(l.capacity);
  });

  it("balances relative load instead of overloading one person", async () => {
    const r = await optimizeAssignment({ apps, reviewers, conflicts: [], requireSenior: false });
    const rel = r.loads.map((l) => l.after / l.capacity);
    expect(Math.max(...rel) - Math.min(...rel)).toBeLessThan(0.35);
  });

  it("reports a shortage instead of failing when capacity is too small", async () => {
    const tiny = reviewers.map((x) => ({ ...x, capacity: x.currentLoad + 1 }));
    const r = await optimizeAssignment({ apps, reviewers: tiny, conflicts: [], requireSenior: false });
    const missing = r.shortages.reduce((s, x) => s + x.missing, 0);
    expect(r.pairs.length + missing).toBe(24);
    expect(r.pairs.length).toBe(4);
  });
});
