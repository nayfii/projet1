import { Logo } from "@/components/brand/logo";
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
      <main className="flex flex-1 items-start justify-center px-4 pb-24 pt-[12vh]">{children}</main>
    </div>
  );
}
