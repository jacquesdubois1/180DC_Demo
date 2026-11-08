/**
 * Prospect import: column detection and row normalisation. Pure functions (no I/O), so they
 * are unit-tested and shared by the upload and the "re-map columns" step.
 */
import { extractDomain, fold, normalizeOrgName } from "./dedup";

export const IMPORT_FIELDS = {
  organization: "Organisation",
  website: "Website",
  type: "Type",
  sector: "Sector",
  city: "City",
  size: "Size / employees",
  full_name: "Contact name",
  first_name: "First name",
  last_name: "Last name",
  email: "E-mail",
  title: "Job title",
  linkedin: "LinkedIn",
  phone: "Phone",
  alumni: "Esade alumni",
  project_idea: "Project idea",
  notes: "Notes",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type ColumnMapping = Partial<Record<ImportField, string>>;

// English, Spanish and Catalan headers seen in real club spreadsheets and CRM exports
const SYNONYMS: Record<ImportField, string[]> = {
  organization: ["organisation", "organization", "company", "company name", "empresa", "entidad", "entitat", "organizacion", "org", "account", "ngo", "ong", "client", "nombre empresa", "nombre de la empresa"],
  website: ["website", "web", "url", "site", "web site", "domain", "dominio", "pagina web", "sitio web", "company website"],
  type: ["type", "tipo", "org type", "organisation type", "organization type", "category", "categoria", "legal form"],
  sector: ["sector", "industry", "industria", "area", "field", "ambito", "impact area"],
  city: ["city", "ciudad", "ciutat", "location", "ubicacion", "town", "localidad", "poblacion", "hq"],
  size: ["size", "employees", "empleados", "tamano", "headcount", "number of employees", "company size", "plantilla"],
  full_name: ["contact", "contact name", "contact person", "persona de contacto", "contacto", "full name", "nombre completo", "name", "decision maker"],
  first_name: ["first name", "firstname", "nombre", "given name", "nom"],
  last_name: ["last name", "lastname", "surname", "apellido", "apellidos", "family name", "cognom", "cognoms"],
  email: ["email", "e mail", "mail", "correo", "correo electronico", "email address", "contact email", "work email"],
  title: ["title", "job title", "role", "position", "cargo", "puesto", "rol"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile", "perfil linkedin", "li"],
  phone: ["phone", "telefono", "tel", "mobile", "movil", "phone number", "telefon"],
  alumni: ["esade alumni", "alumni", "esade", "is alumni", "exalumno"],
  project_idea: ["project", "project idea", "idea", "need", "necesidad", "challenge", "reto"],
  notes: ["notes", "notas", "comments", "comentarios", "remarks", "observaciones"],
};

const clean = (h: string) => fold(h).replace(/[^a-z0-9]+/g, " ").trim();

/** Best header for each field: exact synonym > header starts with synonym > contains it. Each header is used once. */
export function detectMapping(headers: string[]): ColumnMapping {
  const cands: { field: ImportField; header: string; score: number }[] = [];
  for (const h of headers) {
    const c = clean(h);
    if (!c) continue;
    for (const [field, syns] of Object.entries(SYNONYMS) as [ImportField, string[]][]) {
      let score = 0;
      for (const s of syns) {
        if (c === s) score = Math.max(score, 3 + s.length / 100);
        else if (c.startsWith(s + " ") || c.endsWith(" " + s)) score = Math.max(score, 2 + s.length / 100);
        else if (s.length >= 4 && c.includes(s)) score = Math.max(score, 1 + s.length / 100);
      }
      if (score) cands.push({ field, header: h, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const c of cands) {
    if (mapping[c.field] || used.has(c.header)) continue;
    mapping[c.field] = c.header;
    used.add(c.header);
  }
  // a lone "Name" column in a list without a company column is the organisation
  if (!mapping.organization && mapping.full_name && clean(mapping.full_name) === "name" && !mapping.email) {
    mapping.organization = mapping.full_name;
    delete mapping.full_name;
  }
  return mapping;
}

export interface NormalizedRow {
  organization: string | null;
  website: string | null;
  domain: string | null;
  type: "company" | "startup" | "social_enterprise" | "ngo" | "foundation" | "public_sector" | "university" | "other";
  sector: string | null;
  city: string | null;
  size_band: "1-10" | "11-50" | "51-200" | "201-1000" | "1000+" | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  linkedin: string | null;
  phone: string | null;
  is_alumni: boolean;
  project_idea: string | null;
  notes: string | null;
  warnings: string[];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim();
  return t ? t.slice(0, 500) : null;
};
const title = (t: string) => t.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function orgType(v: string | null): NormalizedRow["type"] {
  const t = v ? fold(v) : "";
  if (!t) return "company";
  if (/fundaci|foundation|fundacio/.test(t)) return "foundation";
  if (/\bngo\b|\bong\b|non ?profit|nonprofit|asociaci|associaci|charity|sin animo/.test(t)) return "ngo";
  if (/social|impact|cooperativ|b ?corp/.test(t)) return "social_enterprise";
  if (/start ?up/.test(t)) return "startup";
  if (/public|ayuntamiento|ajuntament|government|gobierno|generalitat|ministry/.test(t)) return "public_sector";
  if (/universi|school|escuela|college/.test(t)) return "university";
  if (/company|empresa|corporate|sme|pyme|business/.test(t)) return "company";
  return "other";
}

export function sizeBand(v: string | null): NormalizedRow["size_band"] {
  if (!v) return null;
  const nums = (v.match(/\d[\d.,]*/g) ?? []).map((x) => Number(x.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")));
  if (!nums.length) return null;
  const n = Math.max(...nums);
  return n <= 10 ? "1-10" : n <= 50 ? "11-50" : n <= 200 ? "51-200" : n <= 1000 ? "201-1000" : "1000+";
}

const truthy = (v: string | null) => !!v && /^(y|yes|si|sí|true|1|x|✓|✔|alumni|esade)/i.test(v.trim());

export function normalizeRow(raw: Record<string, unknown>, m: ColumnMapping): NormalizedRow {
  const get = (f: ImportField) => (m[f] ? s(raw[m[f]!]) : null);
  const warnings: string[] = [];

  let email = get("email")?.toLowerCase().replace(/^mailto:/, "") ?? null;
  if (email && !EMAIL.test(email)) {
    warnings.push(`invalid e-mail “${email}”`);
    email = null;
  }
  let website = get("website");
  if (website && !/^https?:\/\//i.test(website) && website.includes(".")) website = `https://${website.replace(/^\/+/, "")}`;
  const domain = extractDomain(website) ?? extractDomain(email);

  let organization = get("organization");
  if (!organization && domain) {
    organization = title(domain.split(".")[0].replace(/[-_]+/g, " "));
    warnings.push("organisation name derived from the domain");
  }

  let first = get("first_name");
  let last = get("last_name");
  const full = get("full_name");
  if (!first && full) {
    const parts = full.replace(/\s+/g, " ").split(" ");
    first = parts[0];
    last = last ?? (parts.slice(1).join(" ") || null);
  }

  let linkedin = get("linkedin");
  if (linkedin && !/linkedin\.com/i.test(linkedin)) linkedin = null;
  else if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = `https://${linkedin}`;

  return {
    organization, website, domain,
    type: orgType(get("type")),
    sector: get("sector"),
    city: get("city"),
    size_band: sizeBand(get("size")),
    first_name: first, last_name: last, email,
    title: get("title"),
    linkedin,
    phone: get("phone"),
    is_alumni: truthy(get("alumni")),
    project_idea: get("project_idea"),
    notes: get("notes"),
    warnings,
  };
}

/** Key that identifies the same organisation inside one file. */
export function orgKey(r: Pick<NormalizedRow, "domain" | "organization">) {
  return r.domain ? `d:${r.domain}` : r.organization ? `n:${normalizeOrgName(r.organization)}` : null;
}
