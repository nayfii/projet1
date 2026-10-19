import { expect, type Page } from "@playwright/test";
import { latestLinkFor } from "./mail";

const shots = process.env.E2E_SCREENSHOTS;

/** Full-page screenshot into $E2E_SCREENSHOTS (used for the founder's step reports). */
export async function shot(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
}

/** Signs in with a magic link read from the local test mailbox. */
export async function signIn(page: Page, email: string) {
  const before = new Date(Date.now() - 1000);
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir mon lien" }).click();
  await expect(page.getByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeVisible();
  await page.goto(await latestLinkFor(email, before));
}
