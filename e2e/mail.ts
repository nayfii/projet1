import { expect } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Waits for the latest email sent to `to` and returns the first link pointing at our app. */
export async function latestLinkFor(to: string, after: Date, appOrigin = "http://localhost:3000"): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const body = (await res.json()) as { messages: { ID: string; Created: string }[] };
        const fresh = body.messages.find((m) => new Date(m.Created) >= after);
        if (!fresh) return null;
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string };
        const match = msg.HTML.match(/href="([^"]+)"/);
        link = match ? match[1].replace(/&amp;/g, "&") : null;
        return link;
      },
      { timeout: 20_000, intervals: [500] },
    )
    .not.toBeNull();
  expect(link!.startsWith(appOrigin)).toBe(true);
  return link!;
}
