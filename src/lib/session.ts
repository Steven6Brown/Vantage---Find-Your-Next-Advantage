import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest, NextResponse } from "next/server";
import { readSession, type AuthContext, type Ctx } from "./accounts";

// Next.js glue: cookie handling and "who is signed in" checks.
// Pages and API routes call these themselves; the proxy only does a cheap cookie check for UX.

const PROD = process.env.NODE_ENV === "production";
// "__Host-" cookies are Secure, path=/, and can't be set by sibling subdomains.
export const SESSION_COOKIE = PROD ? "__Host-aq_session" : "aq_session";

/** For server components. */
export async function getSession(): Promise<AuthContext | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<AuthContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For route handlers. */
export function sessionFromRequest(req: NextRequest, opts: { allowPending?: boolean } = {}): AuthContext | null {
  return readSession(req.cookies.get(SESSION_COOKIE)?.value, opts);
}

export function setSessionCookie(res: NextResponse, token: string, maxAgeMs?: number) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: PROD,
    path: "/",
    ...(maxAgeMs ? { maxAge: Math.floor(maxAgeMs / 1000) } : {}),
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: PROD, path: "/", maxAge: 0 });
}

export function clientInfo(req: NextRequest): Required<Ctx> {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local",
    ua: req.headers.get("user-agent") ?? "",
  };
}

/**
 * CSRF backstop on top of SameSite=Strict cookies: a browser-supplied Origin (or Sec-Fetch-Site)
 * must be same-origin. Requests without either header can't carry a victim's cookie.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) return origin === req.nextUrl.origin;
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
