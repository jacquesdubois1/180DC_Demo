import type { Metadata } from "next";
import { BrandLockup } from "@/components/brand";
import { ApplyForm } from "@/components/hr/apply-form";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";
import { format } from "date-fns";

export const metadata: Metadata = {
  title: "Apply",
  description: "Apply to 180 Degrees Consulting Barcelona",
  robots: { index: true, follow: true },
};

export default async function ApplyPage() {
  const data = await withService(async (sql) => {
    const [cycle] = await sql<{ id: string; name: string; closes_at: string | null; retention_days: number }[]>`
      select id, name, closes_at, retention_days from recruitment_cycles
      where status = 'open' and (closes_at is null or closes_at > now()) and (opens_at is null or opens_at <= now()) limit 1`;
    if (!cycle) return null;
    const positions = await sql<{ id: string; name: string; description: string | null; questions: { key: string; label: string; required: boolean; max_words?: number }[] }[]>`
      select id, name, description, questions from positions where cycle_id = ${cycle.id} and is_open order by position`;
    return { cycle, positions };
  });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-8"><BrandLockup /></div>
      {env().DEMO_MODE ? (
        <p className="mb-6 rounded-xl bg-warn-soft px-4 py-2.5 text-[13px] text-warn">Demo environment - please do not submit real personal data.</p>
      ) : null}
      {!data ? (
        <>
          <h1 className="text-[30px] font-semibold tracking-tight">Applications are closed</h1>
          <p className="mt-2 text-ink-2">Follow us to hear when the next recruitment cycle opens.</p>
        </>
      ) : (
        <>
          <div className="eyebrow mb-2">{data.cycle.name} recruitment</div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Join 180 Degrees Consulting Barcelona</h1>
          <p className="mt-2 max-w-[62ch] text-ink-2">
            Work in small teams on real consulting projects for NGOs and social enterprises.
            {data.cycle.closes_at ? ` Applications close on ${format(new Date(data.cycle.closes_at), "d MMMM yyyy")}.` : ""}
            {" "}It takes about 20 minutes.
          </p>
          <ApplyForm positions={data.positions} retentionDays={data.cycle.retention_days} />
        </>
      )}
    </main>
  );
}
