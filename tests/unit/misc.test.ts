import { describe, expect, it } from "vitest";
import { renderTemplate } from "@/lib/email/render";
import { termStart } from "@/lib/outreach/stages";

describe("e-mail templates", () => {
  it("fills placeholders and reports missing ones instead of sending blanks", () => {
    const r = renderTemplate("Hi {{first_name}}, about {{ organization }} - {{project_idea}}", { first_name: "Ana", organization: "Nova" });
    expect(r.text).toBe("Hi Ana, about Nova - {{project_idea}}");
    expect(r.missing).toEqual(["project_idea"]);
  });
});

describe("outreach terms", () => {
  it("starts in September for the spring term and in February for the autumn term", () => {
    expect(termStart(new Date("2026-11-08")).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(termStart(new Date("2027-01-15")).toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(termStart(new Date("2027-03-01")).toISOString().slice(0, 10)).toBe("2027-02-01");
  });
});
