import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection only — the authoritative checks live in the
 * data-access layer (`src/server/auth/session.ts`). This runs on every
 * request (Node runtime), so it must stay cheap: cookie presence, no I/O.
 */

const PROTECTED_PREFIXES = ["/admin", "/student", "/super", "/dashboard"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("bridge-session");

  if (!hasSession) {
    const needsAuth = PROTECTED_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    if (needsAuth) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } else if (pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // All pages except API routes, static files, and Next internals.
    "/((?!api/|_next/|sw.js|manifest.webmanifest|icons/|offline|favicon.ico).*)",
  ],
};
