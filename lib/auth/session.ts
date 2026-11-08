import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Demo sessions: a signed, http-only cookie holding the demo user's id (8 hours). */
export const DEMO_COOKIE = "hub_session";
const MAX_AGE = 60 * 60 * 8;

const key = () => new TextEncoder().encode(env().AUTH_SECRET);
// one secret, two token kinds: the audience claim keeps an e-mail link from ever passing as a session
const SESSION_AUD = "hub:session";
const LINK_AUD = "hub:link";

export async function createDemoSession(userId: string) {
  const token = await new SignJWT({ sub: userId, kind: "demo" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(SESSION_AUD)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  (await cookies()).set(DEMO_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function readDemoSession(): Promise<string | null> {
  const token = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: SESSION_AUD });
    return payload.kind === "demo" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function clearDemoSession() {
  (await cookies()).delete(DEMO_COOKIE);
}

/** Signed tokens for links in e-mails (unsubscribe). No database table needed. */
export async function signLinkToken(payload: Record<string, string>, expiresIn = "400d") {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setAudience(LINK_AUD).setIssuedAt().setExpirationTime(expiresIn).sign(key());
}

export async function verifyLinkToken<T extends Record<string, unknown>>(token: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"], audience: LINK_AUD });
    return payload as T;
  } catch {
    return null;
  }
}
