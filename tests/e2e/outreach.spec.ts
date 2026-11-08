import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { signInAs } from "./helpers";

/**
 * The prospect list is built from the seeded CRM so the test does not depend on generated names:
 * one organisation that already exists (same domain), one that asked not to be contacted,
 * one with a slightly different spelling, one repeated row with a second contact, and new ones.
 */
async function buildProspectCsv() {
  const sql = postgres(process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:54322/postgres", { max: 1, onnotice: () => {} });
  try {
    const [existing] = await sql<{ name: string; domain: string }[]>`
      select name, domain::text from organizations where not do_not_contact and domain is not null and name not like '% %' order by name limit 1`;
    const [optedOut] = await sql<{ name: string; domain: string }[]>`select name, domain::text from organizations where do_not_contact and domain is not null limit 1`;
    const [similar] = await sql<{ name: string }[]>`
      select name from organizations where not do_not_contact and length(name) >= 8 and name ~ '^[A-Za-z]+ [A-Za-z]+$' order by name desc limit 1`;
    const stamp = Date.now().toString(36);
    // "Agropath Impact" -> "Agro-path Impact S.L.": same company, different spelling
    const variant = `${similar.name.slice(0, 4)}-${similar.name.slice(4)} S.L.`;
    return [
      "Empresa;Web;Tipo;Sector;Ciudad;Empleados;Persona de contacto;Correo;Cargo;Esade alumni;Notas",
      `Nova Escola ${stamp};nova-${stamp}.example.org;Fundación;Education;Barcelona;35;Marta Serra;marta@nova-${stamp}.example.org;Directora;sí;Met at alumni breakfast`,
      `${existing.name};https://www.${existing.domain};Empresa social;Education;Barcelona;20;Pau Roca;pau.${stamp}@${existing.domain};COO;no;`,
      `${variant};;Startup;Food & agriculture;Girona;12;Laia Puig;laia.${stamp}@gmail.com;Founder;;`,
      `Nova Escola ${stamp};nova-${stamp}.example.org;Fundación;Education;Barcelona;35;Jordi Vila;jordi@nova-${stamp}.example.org;Head of programmes;;`,
      `${optedOut.name};${optedOut.domain};ONG;Health & wellbeing;Barcelona;15;Anna Ruiz;anna.${stamp}@${optedOut.domain};Director;;`,
      `"Cooperativa ""Teixidora ${stamp}""";teixidora-${stamp}.example.net;Cooperativa;Fashion & textiles;Sabadell;8;Núria Font;nuria@teixidora-${stamp}.example.net;Sòcia;x;"Interested in pricing, call in December"`,
    ].join("\r\n");
  } finally {
    await sql.end();
  }
}

test("import a messy Spanish prospect list with duplicate checks", async ({ page }) => {
  const csv = await buildProspectCsv();
  await signInAs(page, "Omar Haddad");
  await page.goto("/outreach/import");
  await page.setInputFiles("input[type=file]", { name: "prospects.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await page.getByRole("button", { name: /Upload/ }).click();
  await page.waitForURL(/\/outreach\/import\/[0-9a-f-]{36}/);

  // Spanish headers were recognised, duplicates and opted-out organisations were found
  await expect(page.getByRole("combobox").first()).toHaveValue("Empresa");
  await expect(page.getByRole("button", { name: /^Needs decision · 1$/ })).toBeVisible(); // opens on what needs a human
  await page.getByRole("button", { name: /^All ·/ }).click();
  await expect(page.getByText(/same domain/)).toBeVisible();
  await expect(page.getByText(/asked not to be contacted/)).toBeVisible();
  await expect(page.getByText(/similar name \(\d+%\)/)).toBeVisible();
  await expect(page.getByText(/adds another contact/)).toBeVisible();

  // a person decides the possible duplicate, then imports
  await page.getByRole("button", { name: /^Needs decision/ }).click();
  await page.getByRole("button", { name: /All: add to existing/ }).click();
  await expect(page.getByRole("button", { name: /^Import \d+ rows/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Import \d+ rows/ }).click();
  await expect(page).toHaveURL(/\/outreach\/pipeline/, { timeout: 30_000 });
  await expect(page.getByText(/leads and \d+ contacts added/)).toBeVisible();
});
