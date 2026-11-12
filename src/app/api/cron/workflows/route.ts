import { tick } from "@/modules/workflows/server/engine";

export const maxDuration = 300;

/**
 * The workflows' clock (Vercel Cron, every 5 minutes; vercel.json): schedules that are due, new e-mails
 * for e-mail triggers, runs that waited long enough and runs an interrupted executor left behind.
 * Only Vercel Cron may call it: it sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json(await tick());
}
