import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { getStudioSnapshot } from "@/modules/studio/server/queries";
import { StudioShell } from "@/modules/studio/ui/shell";
import { StudioProvider } from "@/modules/studio/ui/store";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studio.shell");
  return { title: { template: `%s · ${t("name")}`, default: t("name") } };
}

/**
 * Studio: our team's space to build and run Cendr. Platform admins only (anyone else gets "not
 * found", as for our console); its data is read once here and shared by every Studio page.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();
  const snapshot = await getStudioSnapshot(ctx);
  return (
    <StudioProvider initial={snapshot}>
      <StudioShell>{children}</StudioShell>
    </StudioProvider>
  );
}
