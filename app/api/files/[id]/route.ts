import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { readFileContent } from "@/lib/storage";

/**
 * Authorised file download. Access is decided by row-level security on `files`
 * (app.can_access_file: HR, the uploader, or a non-blind assigned reviewer).
 * Every CV view is written to the audit log.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const allowed = await withUser(user.id, async (sql) => {
    const rows = await sql`select id from files where id = ${id}`;
    if (rows.length) await sql`select app.log_event('file.viewed', 'file', ${id}::uuid, '{}'::jsonb)`;
    return rows.length > 0;
  });
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  const file = await readFileContent(id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${file.filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
