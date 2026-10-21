import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { safeNextPath, trailingNextParam } from "@/lib/safe-redirect";
import { afterSignIn } from "@/modules/identity/server/after-sign-in";

const OTP_TYPES: EmailOtpType[] = ["magiclink", "email", "invite", "signup", "recovery", "email_change"];

/** Target of the links in our auth emails (token hash flow: works even in another browser). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNextPath(trailingNextParam(request.nextUrl.search), publicEnv.appUrl);

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      await afterSignIn(supabase, data.user);
      return NextResponse.redirect(new URL(next, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", request.url));
}
