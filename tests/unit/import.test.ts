import { describe, expect, it } from "vitest";
import { detectMapping, normalizeRow, orgKey, orgType, sizeBand } from "@/lib/outreach/import-map";
import { parseCsv } from "@/lib/outreach/import-parse";

describe("prospect import: column detection", () => {
  it("recognises Spanish and English headers", () => {
    const m = detectMapping(["Empresa", "Web", "Tipo", "Ciudad", "Empleados", "Persona de contacto", "Correo", "Cargo", "Esade alumni", "Notas"]);
    expect(m).toMatchObject({ organization: "Empresa", website: "Web", type: "Tipo", city: "Ciudad", size: "Empleados",
      full_name: "Persona de contacto", email: "Correo", title: "Cargo", alumni: "Esade alumni", notes: "Notas" });
    expect(detectMapping(["Company name", "First name", "Last name", "Work email", "LinkedIn URL"])).toMatchObject({
      organization: "Company name", first_name: "First name", last_name: "Last name", email: "Work email", linkedin: "LinkedIn URL" });
  });

  it("treats a lone Name column as the organisation", () => {
    expect(detectMapping(["Name", "Website", "Sector"]).organization).toBe("Name");
  });
});

describe("prospect import: row normalisation", () => {
  const m = detectMapping(["Empresa", "Web", "Tipo", "Empleados", "Persona de contacto", "Correo", "Esade alumni"]);
  it("cleans values and derives what is missing", () => {
    const r = normalizeRow({ Empresa: "  Nova Escola  ", Web: "novaescola.example.org", Tipo: "Fundación", Empleados: "35",
      "Persona de contacto": "Marta Serra Puig", Correo: "Marta@NovaEscola.example.org", "Esade alumni": "sí" }, m);
    expect(r).toMatchObject({ organization: "Nova Escola", website: "https://novaescola.example.org", domain: "novaescola.example.org",
      type: "foundation", size_band: "11-50", first_name: "Marta", last_name: "Serra Puig", email: "marta@novaescola.example.org", is_alumni: true });
    expect(r.warnings).toEqual([]);
  });

  it("flags invalid e-mails and derives a name from the company domain", () => {
    const r = normalizeRow({ Empresa: "", Correo: "info@acme-impact.example.com" }, m);
    expect(r.organization).toBe("Acme Impact");
    expect(r.warnings).toContain("organisation name derived from the domain");
    expect(normalizeRow({ Empresa: "X", Correo: "bad-email" }, m).warnings[0]).toMatch(/invalid e-mail/);
  });

  it("maps free-text types and sizes", () => {
    expect(orgType("Asociación sin ánimo de lucro")).toBe("ngo");
    expect(orgType("Cooperativa")).toBe("social_enterprise");
    expect(orgType("Ajuntament de Barcelona")).toBe("public_sector");
    expect(sizeBand("45 empleados")).toBe("11-50");
    expect(sizeBand("1.200")).toBe("1000+");
    expect(sizeBand(null)).toBeNull();
  });

  it("identifies the same organisation by domain first, then by name", () => {
    expect(orgKey({ domain: "a.example.org", organization: "A" })).toBe("d:a.example.org");
    expect(orgKey({ domain: null, organization: "Fundació A, S.L." })).toBe("n:fundacio a");
  });
});

describe("CSV parsing", () => {
  it("handles semicolons, quotes, escaped quotes, line breaks in fields and empty lines", () => {
    const rows = parseCsv('﻿Name;Notes\r\n"Coop ""La Teixidora""";"line 1\nline 2"\r\n\r\nB;x\r\n');
    expect(rows[0]).toEqual(["Name", "Notes"]);
    expect(rows[1]).toEqual(['Coop "La Teixidora"', "line 1\nline 2"]);
    expect(rows[2]).toEqual([""]); // kept so that row numbers match the file
    expect(rows[3]).toEqual(["B", "x"]);
  });
});
