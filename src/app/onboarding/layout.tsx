import { getLocale } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { LocaleSwitch } from "@/modules/identity/ui/locale-switch";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <Logo />
        <LocaleSwitch locale={locale} />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-24 pt-[5vh]">
        <LiquidGlass material="panel" reach={46} className="flex w-full max-w-[38rem] justify-center rounded-[28px] border px-5 py-8 sm:px-10 sm:py-10">
          {children}
        </LiquidGlass>
      </main>
    </div>
  );
}
