import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath } from "@/lib/safe-redirect";
import { afterSignIn } from "@/modules/identity/server/after-sign-in";

/**
 * Return URL of Google sign-in and of sign-in links: exchanges the code for a session.
 * Sign-in links built from our email templates go through /auth/confirm first and arrive here
 * already signed in; Supabase's default templates (hosted free plan without our own mail server)
 * arrive with a code, which only works in the browser that asked for the link.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const next = safeNextPath(params.get("next"), publicEnv.appUrl);
  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await afterSignIn(supabase, data.user);
      return NextResponse.redirect(new URL(next, request.url));
    }
  } else {
    const { data } = await supabase.auth.getUser();
    if (data.user) return NextResponse.redirect(new URL(next, request.url));
  }
  const failure = params.get("via") === "email" ? "link_invalid" : "oauth_failed";
  return NextResponse.redirect(new URL(`/login?error=${failure}`, request.url));
}
