"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { dbErrorMessage, type Tx, withUser } from "@/lib/db";
import type { ActionResult } from "@/lib/hr/actions";
import { matchOrganization } from "./dedup";
import { type ColumnMapping, IMPORT_FIELDS, type NormalizedRow, detectMapping, normalizeRow, orgKey } from "./import-map";
import { parseSpreadsheet } from "./import-parse";
import { recomputeScores } from "./score-job";

/*
 * Prospect import in three steps: upload (parse + detect columns + match against the CRM),
 * review (a human confirms every "possible duplicate"), commit (one transaction).
 * The uploaded file itself is not kept - only the parsed rows, and only until the import is
 * committed or discarded (data minimisation).
 */

type MatchStatus = "new" | "duplicate" | "possible_duplicate" | "in_file_duplicate" | "invalid";
type Decision = "pending" | "create" | "merge" | "skip";

interface AnalyzedRow {
  row_number: number;
  raw: Record<string, string>;
  normalized: NormalizedRow;
  match_status: MatchStatus;
  matched_organization_id: string | null;
  matched_person_id: string | null;
  similarity: number | null;
  match_reason: string | null;
  decision: Decision;
}

async function analyze(tx: Tx, input: { rowNumber: number; values: Record<string, string> }[], mapping: ColumnMapping): Promise<AnalyzedRow[]> {
  const raws = input.map((r) => r.values);
  const existing = await tx<{ id: string; normalized: string; domain: string | null; name: string; do_not_contact: boolean }[]>`
    select id, normalized_name as normalized, domain::text as domain, name, do_not_contact from organizations`;
  const norm = raws.map((r) => normalizeRow(r, mapping));
  const emails = [...new Set(norm.map((n) => n.email).filter((e): e is string => !!e))];
  const domains = [...new Set(norm.map((n) => n.domain).filter((d): d is string => !!d))];
  const people = emails.length ? await tx<{ id: string; email: string }[]>`select id, email::text from people where email = any(${emails})` : [];
  const suppressed = emails.length || domains.length ? await tx<{ email: string | null; domain: string | null }[]>`
    select email::text, domain::text from email_suppressions where email = any(${emails}) or domain = any(${domains})` : [];
  const supEmail = new Set(suppressed.map((x) => x.email).filter(Boolean));
  const supDomain = new Set(suppressed.map((x) => x.domain).filter(Boolean));
  const byEmail = new Map(people.map((p) => [p.email, p.id]));
  const nameOf = new Map(existing.map((e) => [e.id, e.name]));
  const dnc = new Set(existing.filter((e) => e.do_not_contact).map((e) => e.id));

  const seen = new Map<string, { row: number; emails: Set<string>; matched: string | null; skipped: boolean }>();
  return norm.map((n, i) => {
    const row_number = input[i].rowNumber; // as shown in Excel
    const base = { row_number, raw: raws[i], normalized: n, matched_person_id: n.email ? byEmail.get(n.email) ?? null : null };
    if (!n.organization) {
      return { ...base, match_status: "invalid", matched_organization_id: null, similarity: null, match_reason: "no organisation name, website or company e-mail", decision: "skip" };
    }
    if ((n.email && supEmail.has(n.email)) || (n.domain && supDomain.has(n.domain))) {
      n.warnings.push("on the do-not-contact list");
    }
    const key = orgKey(n)!;
    const prev = seen.get(key);
    if (prev) {
      const sameContact = !n.email || prev.emails.has(n.email);
      if (n.email) prev.emails.add(n.email);
      return { ...base, match_status: "in_file_duplicate", matched_organization_id: prev.matched, similarity: 1,
        match_reason: prev.skipped ? `same organisation as row ${prev.row}, which is skipped`
          : sameContact ? `same as row ${prev.row}` : `same organisation as row ${prev.row} - adds another contact`,
        decision: sameContact || prev.skipped ? "skip" : "merge" };
    }
    const m = matchOrganization({ name: n.organization, domain: n.domain }, existing);
    const isDnc = !!m.id && dnc.has(m.id);
    seen.set(key, { row: row_number, emails: new Set(n.email ? [n.email] : []), matched: m.status === "duplicate" ? m.id : null, skipped: isDnc });
    if (isDnc) {
      return { ...base, match_status: "duplicate", matched_organization_id: m.id, similarity: m.similarity,
        match_reason: `${nameOf.get(m.id!)} asked not to be contacted`, decision: "skip" };
    }
    return {
      ...base,
      match_status: m.status,
      matched_organization_id: m.id,
      similarity: m.similarity ? Math.round(m.similarity * 1000) / 1000 : null,
      match_reason: m.id ? `${m.reason}: ${nameOf.get(m.id)}` : null,
      decision: m.status === "new" ? "create" : m.status === "duplicate" ? "merge" : "pending",
    };
  });
}

function statsOf(rows: AnalyzedRow[]) {
  const c = (s: MatchStatus) => rows.filter((r) => r.match_status === s).length;
  return { rows: rows.length, new: c("new"), duplicate: c("duplicate"), possible_duplicate: c("possible_duplicate"),
    in_file_duplicate: c("in_file_duplicate"), invalid: c("invalid"), with_email: rows.filter((r) => r.normalized.email).length };
}

async function writeRows(tx: Tx, importId: string, rows: AnalyzedRow[]) {
  await tx`delete from prospect_import_rows where import_id = ${importId}`;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      import_id: importId, row_number: r.row_number, raw: r.raw, normalized: r.normalized, match_status: r.match_status,
      matched_organization_id: r.matched_organization_id, matched_person_id: r.matched_person_id,
      similarity: r.similarity, match_reason: r.match_reason, decision: r.decision,
    }));
    await tx`insert into prospect_import_rows ${tx(chunk as never[], "import_id", "row_number", "raw", "normalized", "match_status",
      "matched_organization_id", "matched_person_id", "similarity", "match_reason", "decision")}`;
  }
}

export type UploadState = { ok: false; error: string } | null;

export async function uploadImport(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const user = await requireRole("client_relations");
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Choose an Excel (.xlsx) or CSV file" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "The file is larger than 5 MB" };
  if (!/\.(xlsx|csv|tsv|txt)$/i.test(file.name)) return { ok: false, error: "Only .xlsx and .csv files are supported (in Excel: File > Save as > .xlsx)" };
  const bytes = Buffer.from(await file.arrayBuffer());
  let parsed: Awaited<ReturnType<typeof parseSpreadsheet>>;
  try {
    parsed = await parseSpreadsheet(bytes, file.name);
  } catch {
    return { ok: false, error: "The file could not be read. Is it a valid Excel or CSV file?" };
  }
  if (!parsed.rows.length) return { ok: false, error: "No rows found - the first sheet needs a header row and at least one data row" };
  const mapping = detectMapping(parsed.headers);
  if (!mapping.organization && !mapping.website && !mapping.email) {
    return { ok: false, error: `No organisation, website or e-mail column recognised. Columns found: ${parsed.headers.join(", ")}` };
  }
  let id: string;
  try {
    id = await withUser(user.id, async (tx) => {
      const rows = await analyze(tx, parsed.rows, mapping);
      const [imp] = await tx<{ id: string }[]>`
        insert into prospect_imports (filename, column_mapping, stats)
        values (${file.name.slice(0, 200)}, ${tx.json({ mapping, headers: parsed.headers } as never)}, ${tx.json({ ...statsOf(rows), truncated: parsed.truncated } as never)})
        returning id`;
      await writeRows(tx, imp.id, rows);
      await tx`select app.log_event('outreach.import_uploaded', 'prospect_import', ${imp.id}, ${tx.json({ rows: rows.length })})`;
      return imp.id;
    });
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
  revalidatePath("/outreach/import");
  redirect(`/outreach/import/${id}`);
}

const mappingSchema = z.record(z.enum(Object.keys(IMPORT_FIELDS) as [keyof typeof IMPORT_FIELDS, ...(keyof typeof IMPORT_FIELDS)[]]), z.string().max(200));

export async function remapImport(importId: string, mapping: ColumnMapping): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  const p = mappingSchema.safeParse(mapping);
  if (!p.success || !z.string().uuid().safeParse(importId).success) return { ok: false, error: "Invalid mapping" };
  const clean = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v)) as ColumnMapping;
  try {
    await withUser(user.id, async (tx) => {
      const [imp] = await tx<{ status: string; column_mapping: { headers: string[] } }[]>`select status, column_mapping from prospect_imports where id = ${importId} for update`;
      if (!imp || imp.status !== "review") throw Object.assign(new Error("This import can no longer be changed"), { code: "22023" });
      const raws = await tx<{ row_number: number; raw: Record<string, string> }[]>`select row_number, raw from prospect_import_rows where import_id = ${importId} order by row_number`;
      const rows = await analyze(tx, raws.map((r) => ({ rowNumber: r.row_number, values: r.raw })), clean);
      await writeRows(tx, importId, rows);
      await tx`update prospect_imports set column_mapping = ${tx.json({ mapping: clean, headers: imp.column_mapping.headers } as never)},
        stats = stats || ${tx.json(statsOf(rows) as never)} where id = ${importId}`;
    });
    revalidatePath(`/outreach/import/${importId}`);
    return { ok: true, message: "Columns re-mapped and rows re-checked" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function setImportDecision(importId: string, rowIds: string[], decision: Exclude<Decision, "pending">): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  if (!["create", "merge", "skip"].includes(decision) || !rowIds.every((r) => z.string().uuid().safeParse(r).success)) return { ok: false, error: "Invalid request" };
  try {
    await withUser(user.id, (tx) => tx`
      update prospect_import_rows r set decision = ${decision}
      from prospect_imports i
      where i.id = r.import_id and i.id = ${importId} and i.status = 'review' and r.id = any(${rowIds})
        and r.match_status <> 'invalid'
        and (${decision} <> 'merge' or r.matched_organization_id is not null or r.match_status = 'in_file_duplicate')`);
    revalidatePath(`/outreach/import/${importId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

export async function discardImport(importId: string): Promise<ActionResult> {
  const user = await requireRole("client_relations");
  try {
    await withUser(user.id, async (tx) => {
      await tx`update prospect_imports set status = 'discarded' where id = ${importId} and status = 'review'`;
      await tx`delete from prospect_import_rows where import_id = ${importId}`;
    });
    revalidatePath("/outreach/import");
    return { ok: true, message: "Import discarded - the uploaded rows were deleted" };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}

const commitSchema = z.object({
  importId: z.string().uuid(),
  owner: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("me") }),
    z.object({ mode: z.literal("round_robin") }),
    z.object({ mode: z.literal("user"), userId: z.string().uuid() }),
  ]),
  source: z.enum(["import", "alumni", "event", "referral"]).default("import"),
});

export async function commitImport(input: z.infer<typeof commitSchema>): Promise<ActionResult<{ leads: number }>> {
  const user = await requireRole("client_relations");
  const p = commitSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Invalid request" };
  const { importId, owner, source } = p.data;
  try {
    const stats = await withUser(user.id, async (tx) => {
      const [imp] = await tx<{ status: string }[]>`select status from prospect_imports where id = ${importId} for update`;
      if (!imp || imp.status !== "review") throw Object.assign(new Error("This import was already committed or discarded"), { code: "22023" });
      const rows = await tx<{ id: string; row_number: number; normalized: NormalizedRow; match_status: MatchStatus; matched_organization_id: string | null; decision: Decision }[]>`
        select id, row_number, normalized, match_status, matched_organization_id, decision from prospect_import_rows
        where import_id = ${importId} order by row_number`;
      const pending = rows.filter((r) => r.decision === "pending").length;
      if (pending) throw Object.assign(new Error(`${pending} possible duplicate(s) still need a decision`), { code: "22023" });

      // owners: "round robin" balances by open leads, so the person with the lightest pipeline gets the next lead
      const team = await tx<{ id: string; open: number }[]>`
        select u.id, count(l.id) filter (where l.stage not in ('won', 'lost', 'not_interested'))::int as open
        from app_users u join user_roles r on r.user_id = u.id and r.role = 'client_relations'
        left join leads l on l.owner_id = u.id where u.is_active group by u.id`;
      const load = new Map(team.map((t) => [t.id, t.open]));
      const pickOwner = () => {
        if (owner.mode === "me") return user.id;
        if (owner.mode === "user") return owner.userId;
        let best = user.id;
        let min = Infinity;
        for (const [id, n] of load) if (n < min) { min = n; best = id; }
        load.set(best, (load.get(best) ?? 0) + 1);
        return best;
      };

      const s = { organizations_created: 0, organizations_updated: 0, contacts_added: 0, leads_created: 0, skipped: 0, notes: 0 };
      const orgByKey = new Map<string, string>();
      for (const r of rows) {
        const n = r.normalized;
        const key = orgKey(n);
        if (r.decision === "skip" || !key) { s.skipped++; continue; }

        // 1. organisation
        let orgId = r.decision === "merge" ? (r.matched_organization_id ?? orgByKey.get(key) ?? null) : orgByKey.get(key) ?? null;
        if (!orgId) {
          const [o] = await tx<{ id: string }[]>`
            insert into organizations (name, website, domain, type, sector, city, size_band, source)
            values (${n.organization}, ${n.website}, ${n.domain}, ${n.type}, ${n.sector}, ${n.city}, ${n.size_band}, 'import')
            on conflict (domain) where domain is not null do nothing returning id`;
          orgId = o?.id ?? (await tx<{ id: string }[]>`select id from organizations where domain = ${n.domain}`)[0]?.id ?? null;
          if (!orgId) { s.skipped++; continue; }
          if (o) s.organizations_created++;
        } else {
          const u = await tx`update organizations set website = coalesce(website, ${n.website}), sector = coalesce(sector, ${n.sector}),
              city = coalesce(city, ${n.city}), size_band = coalesce(size_band, ${n.size_band})
            where id = ${orgId} and (website is null or sector is null or city is null or size_band is null) returning id`;
          if (u.length) s.organizations_updated++;
        }
        orgByKey.set(key, orgId);
        // re-check opt-outs at commit time: decisions can be edited, opt-outs win
        const [blocked] = await tx<{ b: boolean }[]>`
          select (select do_not_contact from organizations where id = ${orgId})
              or (${n.email}::text is not null and app.is_suppressed(${n.email})) as b`;
        if (blocked?.b) { s.skipped++; continue; }

        // 2. contact person (people are unique by e-mail; someone invisible to this team is not touched)
        let personId: string | null = null;
        if (n.email || n.first_name) {
          if (n.email) personId = (await tx<{ id: string }[]>`select id from people where email = ${n.email}`)[0]?.id ?? null;
          else personId = (await tx<{ id: string }[]>`
            select p.id from people p join person_roles pr on pr.person_id = p.id and pr.organization_id = ${orgId} and pr.role = 'contact'
            where lower(p.first_name) = lower(${n.first_name}) and lower(p.last_name) = lower(${n.last_name ?? ""}) limit 1`)[0]?.id ?? null;
          if (!personId) {
            const [np] = await tx<{ id: string }[]>`
              insert into people (first_name, last_name, email, linkedin_url, phone)
              values (${n.first_name ?? ""}, ${n.last_name ?? ""}, ${n.email}, ${n.linkedin}, ${n.phone})
              on conflict (email) do nothing returning id`;
            personId = np?.id ?? null;
          } else {
            await tx`update people set linkedin_url = coalesce(linkedin_url, ${n.linkedin}), phone = coalesce(phone, ${n.phone}) where id = ${personId}`;
          }
          if (personId) {
            const pr = await tx`insert into person_roles (person_id, role, organization_id, title, is_esade_alumni)
              values (${personId}, 'contact', ${orgId}, ${n.title}, ${n.is_alumni})
              on conflict (person_id, organization_id) where role = 'contact' and end_date is null
              do update set title = coalesce(person_roles.title, excluded.title), is_esade_alumni = person_roles.is_esade_alumni or excluded.is_esade_alumni
              returning (xmax = 0) as inserted`;
            if ((pr[0] as { inserted?: boolean } | undefined)?.inserted) s.contacts_added++;
          }
        }

        // 3. lead (at most one open lead per organisation)
        let [lead] = await tx<{ id: string }[]>`select id from leads where organization_id = ${orgId} and stage not in ('won', 'lost', 'not_interested')`;
        if (!lead) {
          [lead] = await tx<{ id: string }[]>`
            insert into leads (organization_id, owner_id, source, project_idea, next_step, next_step_due, priority)
            values (${orgId}, ${pickOwner()}, ${source}, ${n.project_idea}, 'Send first e-mail', current_date + 2, ${n.is_alumni ? 1 : 2})
            returning id`;
          s.leads_created++;
        }
        if (personId) {
          await tx`insert into lead_contacts (lead_id, person_id, is_primary)
            values (${lead.id}, ${personId}, not exists (select 1 from lead_contacts where lead_id = ${lead.id} and is_primary))
            on conflict do nothing`;
        }
        if (n.notes) {
          await tx`insert into interactions (organization_id, lead_id, person_id, type, subject, summary)
            values (${orgId}, ${lead.id}, ${personId}, 'note', 'Imported note', ${n.notes})`;
          s.notes++;
        }
      }
      await tx`update prospect_imports set status = 'committed', committed_at = now(), stats = stats || ${tx.json({ committed: s } as never)} where id = ${importId}`;
      // the raw rows are not needed any more
      await tx`update prospect_import_rows set raw = '{}'::jsonb where import_id = ${importId}`;
      await tx`select app.log_event('outreach.import_committed', 'prospect_import', ${importId}, ${tx.json(s)})`;
      await recomputeScores(tx);
      return s;
    });
    revalidatePath("/outreach", "layout");
    return {
      ok: true, data: { leads: stats.leads_created },
      message: `${stats.leads_created} leads and ${stats.contacts_added} contacts added, ${stats.organizations_created} new organisations, ${stats.skipped} rows skipped`,
    };
  } catch (err) {
    return { ok: false, error: dbErrorMessage(err) };
  }
}
