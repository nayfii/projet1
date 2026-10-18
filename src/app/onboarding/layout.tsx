import { getLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitch } from "@/modules/identity/ui/locale-switch";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <Logo />
        <LocaleSwitch locale={locale} />
      </header>
      <main className="flex flex-1 justify-center px-4 pb-24 pt-[8vh]">{children}</main>
    </div>
  );
}
