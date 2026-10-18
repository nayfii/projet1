import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import { afterSignIn } from "@/modules/identity/server/after-sign-in";

/** OAuth (Google) return URL: exchanges the code for a session. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), publicEnv.appUrl);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await afterSignIn(supabase, data.user);
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
}
