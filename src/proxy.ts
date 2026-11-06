import { NextResponse, type NextRequest } from "next/server";

// Cheap first gate: no session cookie, no app. This only improves the experience (redirects);
// every page and API route still validates the session against the database itself.
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-aq_session" : "aq_session";
const PUBLIC_PAGES = new Set(["/login", "/setup", "/forgot-password", "/reset-password", "/verify-email"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // /api/auth/* handlers do their own checks; /api/cron uses its bearer secret.
  if (PUBLIC_PAGES.has(pathname) || pathname.startsWith("/api/auth/") || pathname === "/api/cron") return NextResponse.next();
  if (req.cookies.has(COOKIE)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

// Static brand images must load on the sign-in page, before anyone is signed in.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|logo\\.png|icon\\.png).*)"] };
