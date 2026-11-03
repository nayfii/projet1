import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// "/api/version": the running version, read by the launch and check workflows (no data).
const PUBLIC_PREFIXES = ["/login", "/auth/", "/invite/", "/api/version"];

/**
 * Runs before every page: refreshes the Supabase session cookie and sends signed-out
 * visitors to the sign-in page. Authorisation itself is checked again in every page,
 * server action and route handler (see src/lib/auth/guards.ts) and by RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Verifies the session's token (locally with the project's signing keys, without a round trip to the
  // Auth server when it can) and refreshes it when it is about to expire.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? { id: data.claims.sub } : null;

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));

  // A conversation or a client the person may not open: a real 404, decided before the page starts
  // streaming (pages show a loading shape at once, after which the status can no longer change).
  // Same RLS check as the page itself; link prefetches only fetch the loading shape and are skipped.
  const guarded = /^\/(chat|clients)\/([0-9a-f-]{36})$/i.exec(pathname);
  if (user && guarded && !request.headers.get("next-router-prefetch")) {
    const { data: visible } = await supabase
      .from(guarded[1] === "chat" ? "conversations" : "clients")
      .select("id")
      .eq("id", guarded[2])
      .maybeSingle();
    if (!visible) return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  }

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
