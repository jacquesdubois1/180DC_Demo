import { NextResponse } from "next/server";
import { readUnsubscribeToken, unsubscribeEmail } from "@/lib/email/unsubscribe";

/**
 * RFC 8058 one-click unsubscribe. Gmail/Outlook POST "List-Unsubscribe=One-Click" here when
 * the recipient clicks "Unsubscribe" next to the sender name. A GET (a person opening the
 * URL) goes to the confirmation page instead.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  const email = await readUnsubscribeToken(token);
  if (!email) return NextResponse.json({ ok: false }, { status: 400 });
  await unsubscribeEmail(email, "one_click");
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request, ctx: RouteContext<"/api/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, req.url), 303);
}
