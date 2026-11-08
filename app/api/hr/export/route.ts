import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { getApplications, resolveCycle } from "@/lib/hr/queries";

/** CSV export of the filtered application list (HR only, logged). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasRole(user, "hr")) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const { cycle } = await resolveCycle(user, url.searchParams.get("cycle") ?? undefined);
  const apps = await getApplications(user, cycle.id, {
    position: url.searchParams.get("position") || undefined,
    stage: url.searchParams.get("stage") || undefined,
    q: url.searchParams.get("q") || undefined,
  });
  await withUser(user.id, (sql) => sql`select app.log_event('applications.exported', 'cycle', ${cycle.id}::uuid, ${sql.json({ rows: apps.length })})`);
  const cols = ["alias", "first_name", "last_name", "email", "position_name", "stage", "university", "degree_program", "study_year",
    "avg_score", "reviews_submitted", "yes_votes", "maybe_votes", "no_votes", "submitted_at"] as const;
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // guard against CSV formula injection in spreadsheet apps
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [cols.join(","), ...apps.map((a) => cols.map((c) => esc(a[c])).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="applications-${cycle.slug}.csv"`, "Cache-Control": "no-store" },
  });
}
