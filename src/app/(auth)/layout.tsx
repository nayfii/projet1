import { Logo } from "@/components/brand/logo";
import { LiquidGlass } from "@/components/ui/liquid-glass";
import { LocaleSwitch } from "@/modules/identity/ui/locale-switch";
import { getLocale } from "next-intl/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-6">
        <Logo />
        <LocaleSwitch locale={locale} />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-24 pt-[9vh]">
        {/* Sign-in, password and invitation screens: one pane of glass on the living background. */}
        <LiquidGlass material="panel" reach={46} className="flex w-full max-w-[27rem] justify-center rounded-[28px] border px-6 py-9 sm:px-10 sm:py-11">
          {children}
        </LiquidGlass>
      </main>
    </div>
  );
}
