import { describe, expect, it } from "vitest";
import { extractDomain, jaroWinkler, matchOrganization, normalizeOrgName } from "@/lib/outreach/dedup";

describe("organisation de-duplication", () => {
  it("normalises legal forms, accents and punctuation", () => {
    expect(normalizeOrgName("Ecoalf Recycled Fabrics, S.L.")).toBe("ecoalf recycled fabrics");
    expect(normalizeOrgName("ECOALF recycled fabrics")).toBe("ecoalf recycled fabrics");
    expect(normalizeOrgName("Fundació Ñandú GmbH")).toBe("fundacio nandu");
  });

  it("takes the domain from websites and company e-mails, never from free mail", () => {
    expect(extractDomain("https://www.ecoalf.com/es/about?x=1")).toBe("ecoalf.com");
    expect(extractDomain("maria@ecoalf.com")).toBe("ecoalf.com");
    expect(extractDomain("pepe@gmail.com")).toBeNull();
    expect(extractDomain("not a url")).toBeNull();
  });

  it("computes Jaro-Winkler like the reference implementation", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dixon", "dicksonx")).toBeCloseTo(0.813, 3);
    expect(jaroWinkler("abc", "abc")).toBe(1);
  });

  it("separates sure duplicates, possible duplicates and new organisations", () => {
    const existing = [
      { id: "1", normalized: "agropath impact", domain: "agropath.example.com" },
      { id: "2", normalized: "kidsnest", domain: null },
    ];
    expect(matchOrganization({ name: "Totally different", domain: "agropath.example.com" }, existing)).toMatchObject({ status: "duplicate", id: "1" });
    expect(matchOrganization({ name: "AGROPATH IMPACT, S.L.", domain: null }, existing)).toMatchObject({ status: "duplicate", id: "1" });
    expect(matchOrganization({ name: "Agro-path Impact S.L.", domain: null }, existing)).toMatchObject({ status: "possible_duplicate", id: "1" });
    expect(matchOrganization({ name: "Kidsnet", domain: null }, existing).status).toBe("possible_duplicate");
    expect(matchOrganization({ name: "Water for All", domain: "wfa.example.org" }, existing).status).toBe("new");
  });
});
