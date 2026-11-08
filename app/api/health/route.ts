import { NextResponse } from "next/server";
import { withService } from "@/lib/db";

/** Liveness + database check for uptime monitors. Reveals no data. */
export async function GET() {
  const t = Date.now();
  try {
    const [r] = await withService((sql) => sql<{ version: string | null }[]>`select app.schema_version() as version`);
    return NextResponse.json({ ok: true, db: "up", schema: r?.version ?? null, latency_ms: Date.now() - t });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
