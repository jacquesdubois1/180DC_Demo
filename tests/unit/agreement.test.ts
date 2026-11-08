import { describe, expect, it } from "vitest";
import { krippendorffAlphaInterval } from "@/lib/analytics/agreement";

describe("Krippendorff's alpha (interval)", () => {
  it("reproduces the textbook example (Krippendorff 2011: alpha = 0.849)", () => {
    // 12 units rated by up to 4 coders; missing ratings left out
    const units = [[1, 1, 1], [2, 2, 3, 2], [3, 3, 3, 3], [3, 3, 3, 3], [2, 2, 2, 2], [1, 2, 3, 4],
      [4, 4, 4, 4], [1, 1, 2, 1], [2, 2, 2, 2], [5, 5, 5], [1, 1], [3]];
    const r = krippendorffAlphaInterval(units);
    expect(r.alpha).toBeCloseTo(0.849, 3);
    expect(r.nUnits).toBe(11); // the unit with a single rating is not pairable
  });

  it("is 1 for perfect agreement and below 0.2 for unrelated scores", () => {
    expect(krippendorffAlphaInterval([[1, 1], [3, 3], [5, 5]]).alpha).toBe(1);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const noise = Array.from({ length: 300 }, () => [1 + Math.floor(rnd() * 5), 1 + Math.floor(rnd() * 5)]);
    expect(Math.abs(krippendorffAlphaInterval(noise).alpha)).toBeLessThan(0.2);
  });
});
