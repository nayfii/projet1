import { APP_VERSION, RELEASE_DATE } from "@/lib/version";

/** The running version (public: used by the launch and check workflows to see when a version is live). */
export function GET() {
  return Response.json(
    {
      version: APP_VERSION,
      date: RELEASE_DATE,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
