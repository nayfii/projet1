import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { landingPath, safeNextPath } from "@/lib/safe-redirect";
import { afterSignIn } from "@/modules/identity/server/after-sign-in";

const OTP_TYPES: EmailOtpType[] = ["magiclink", "email", "invite", "signup", "recovery", "email_change"];

/** Target of the links in our auth emails (token hash flow: works even in another browser, except "pkce_" tokens). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNextPath(params.get("next"), publicEnv.appUrl);

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    // A link asked for in this browser (first sign-in to confirm, with the code flow) carries a
    // "pkce_" token: Supabase checks it, then sends the browser to /auth/callback with a code.
    if (tokenHash.startsWith("pkce_")) {
      const verify = new URL("/auth/v1/verify", publicEnv.supabaseUrl);
      verify.searchParams.set("token", tokenHash);
      verify.searchParams.set("type", type === "email" ? "signup" : type);
      verify.searchParams.set("redirect_to", new URL(next.startsWith("/auth/callback") ? next : `/auth/callback?via=email&next=${encodeURIComponent(next)}`, publicEnv.appUrl).toString());
      return NextResponse.redirect(verify);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      const { isPlatformAdmin } = await afterSignIn(supabase, data.user);
      return NextResponse.redirect(new URL(landingPath(next, isPlatformAdmin), request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));
}
