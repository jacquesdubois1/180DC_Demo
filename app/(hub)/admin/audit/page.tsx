import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 50;

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const admin = await requireRole("admin");
  const sp = await props.searchParams;
  const area = typeof sp.area === "string" && /^[a-z_]+$/.test(sp.area) ? sp.area : null;
  const actor = typeof sp.actor === "string" && /^[0-9a-f-]{36}$/i.test(sp.actor) ? sp.actor : null;
  const q = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim().slice(0, 80) : null;
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : null;
  const d = await withUser(admin.id, async (sql) => ({
    rows: await sql<{ id: number; at: string; action: string; entity: string | null; entity_id: string | null; actor: string | null; details: Record<string, unknown> }[]>`
      select a.id, a.at, a.action, a.entity, a.entity_id, (select display_name from app_users u where u.id = a.actor_id) as actor, a.details
      from audit_log a
      where (${area}::text is null or split_part(a.action, '.', 1) = ${area})
        and (${actor}::uuid is null or a.actor_id = ${actor})
        and (${q}::text is null or a.action ilike '%' || ${q} || '%' or a.details::text ilike '%' || ${q} || '%')
        and (${before}::bigint is null or a.id < ${before})
      order by a.id desc limit ${PAGE + 1}`,
    areas: (await sql<{ area: string }[]>`select distinct split_part(action, '.', 1) as area from audit_log order by 1`).map((r) => r.area),
    actors: await sql<{ id: string; display_name: string }[]>`select id, display_name from app_users order by display_name`,
  }));
  const rows = d.rows.slice(0, PAGE);
  const next = d.rows.length > PAGE ? rows.at(-1)?.id : null;
  const qs = (extra: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ area, actor, q, ...extra })) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader eyebrow="Admin" title="Audit log"
        description="Append-only record of sensitive actions: decisions, role changes, imports, exports, deletions. Not even admins can edit it - the database rejects changes." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Select name="area" defaultValue={area ?? ""} className="w-44">
          <option value="">All areas</option>
          {d.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select name="actor" defaultValue={actor ?? ""} className="w-48">
          <option value="">Everyone</option>
          {d.actors.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </Select>
        <Input name="q" defaultValue={q ?? ""} placeholder="Search action or details" className="w-64" />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Card>
        <Table>
          <THead><TR><TH className="w-40">When</TH><TH>Action</TH><TH>By</TH><TH>Details</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap tabular text-ink-2">{format(new Date(r.at), "d MMM yyyy, HH:mm")}</TD>
                <TD className="font-medium">{r.action}{r.entity ? <div className="text-[12px] font-normal text-ink-3">{r.entity}{r.entity_id ? ` ${r.entity_id.slice(0, 8)}` : ""}</div> : null}</TD>
                <TD className="text-ink-2">{r.actor ?? <span className="text-ink-3">system</span>}</TD>
                <TD className="max-w-[520px] truncate font-mono text-[12px] text-ink-3" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</TD>
              </TR>
            ))}
            {!rows.length ? <TR><TD colSpan={4} className="py-6 text-center text-ink-3">No entries.</TD></TR> : null}
          </TBody>
        </Table>
      </Card>
      <div className="mt-3 flex justify-between text-[13px]">
        {before ? <Link href={qs({ before: null })} className="text-brand hover:underline">← Newest</Link> : <span />}
        {next ? <Link href={qs({ before: next })} className="text-brand hover:underline">Older →</Link> : null}
      </div>
    </>
  );
}
