import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { getScaleSnapshot } from "@/modules/scale/server/queries";
import { ScaleShell } from "@/modules/scale/ui/shell";
import { ScaleProvider } from "@/modules/scale/ui/store";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("scale.shell");
  return { title: { template: `%s · ${t("name")}`, default: t("name") } };
}

/**
 * Scale: our team's space to structure and grow Cendr. Platform admins only (anyone else gets "not
 * found", as for our console); its data is read once here and shared by every Scale page.
 */
export default async function ScaleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();
  const snapshot = await getScaleSnapshot(ctx);
  return (
    <ScaleProvider initial={snapshot}>
      <ScaleShell>{children}</ScaleShell>
    </ScaleProvider>
  );
}
