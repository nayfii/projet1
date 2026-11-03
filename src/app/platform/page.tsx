import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  ArrowUpRightIcon,
  BuildingIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  MonitorCheckIcon,
  RocketIcon,
  UserPlusIcon,
  WrenchIcon,
} from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/public-env";
import { releaseConfig } from "@/lib/env";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { providersWithKeys } from "@/modules/providers/server/registry";
import { PROVIDER_BRANDS, PROVIDER_IDS } from "@/modules/providers/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platformNav");
  return { title: t("home") };
}

type Dashboard = {
  companies: { active: number; suspended: number; new_this_month: number };
  people: { seats: number; active_today: number; active_7d: number };
  today: { requests: number; errors: number; credits: number; cost_usd: number };
  month: { requests: number; credits: number; cost_usd: number };
  revenue_month: Record<string, number>;
  near_quota: number;
  usd_to_eur: number | null;
};

/** The tools we use every day, one click away (they open in a new tab). */
function externalTools(): { key: string; name: string; href: string; color: string }[] {
  const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(publicEnv.supabaseUrl)?.[1];
  const repo = releaseConfig().repository;
  return [
    { key: "vercel", name: "Vercel", href: "https://vercel.com/dashboard", color: "bg-foreground text-background" },
    { key: "supabase", name: "Supabase", href: projectRef ? `https://supabase.com/dashboard/project/${projectRef}` : "https://supabase.com/dashboard", color: "bg-emerald-500/15 text-emerald-400" },
    { key: "github", name: "GitHub", href: `https://github.com/${repo}`, color: "bg-foreground/10 text-foreground" },
    { key: "openai", name: "OpenAI", href: "https://platform.openai.com/usage", color: "bg-[var(--pastel-mint)]/20 text-[var(--pastel-mint)]" },
    { key: "anthropic", name: "Anthropic", href: "https://platform.claude.com", color: "bg-[var(--pastel-peach)]/20 text-[var(--pastel-peach)]" },
    { key: "aistudio", name: "AI Studio", href: "https://aistudio.google.com", color: "bg-[var(--pastel-sky)]/20 text-[var(--pastel-sky)]" },
    { key: "googlecloud", name: "Google Cloud", href: "https://console.cloud.google.com/billing", color: "bg-sky-500/15 text-sky-400" },
    { key: "hostinger", name: "Hostinger", href: "https://hpanel.hostinger.com", color: "bg-violet-500/15 text-violet-400" },
    { key: "workspace", name: "Workspace", href: "https://admin.google.com", color: "bg-amber-500/15 text-amber-400" },
    { key: "gmail", name: "Gmail", href: "https://mail.google.com", color: "bg-red-500/15 text-red-400" },
  ];
}

/** Our console's home: the numbers to check every morning, what needs attention, and shortcuts. */
export default async function PlatformHomePage() {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platformHome");
  const format = await getFormatter();
  const supabase = await createClient();
  const [{ data }, { data: lastCheck }] = await Promise.all([
    supabase.rpc("platform_dashboard", { p_tz: "Europe/Paris" }),
    supabase.from("platform_check_runs").select("status, version, finished_at").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const d = (data ?? null) as Dashboard | null;
  const rate = d?.usd_to_eur ?? null;
  const eur = (usd: number) => (rate ? usd * rate : null);
  const money = (value: number | null, currency = "EUR") =>
    value === null ? "—" : format.number(value, { style: "currency", currency, maximumFractionDigits: value < 100 ? 2 : 0 });
  const n = (v: number) => format.number(v, { maximumFractionDigits: 0 });
  const revenue = d?.revenue_month?.EUR ?? null;
  const costMonthEur = d ? eur(d.month.cost_usd) : null;
  const margin = revenue && costMonthEur !== null && revenue > 0 ? Math.round(((revenue - costMonthEur) / revenue) * 100) : null;
  const keys = providersWithKeys();
  const missingKeys = PROVIDER_IDS.filter((p) => !keys.has(p));

  const alerts = [
    ...(lastCheck?.status === "failed" ? [{ href: "/platform/preview", text: t("alertCheck", { version: lastCheck.version ?? "" }) }] : []),
    ...(missingKeys.length ? [{ href: "/platform/health", text: t("alertKeys", { names: missingKeys.map((p) => PROVIDER_BRANDS[p]).join(", ") }) }] : []),
    ...(d && d.near_quota > 0 ? [{ href: "/platform/companies", text: t("alertQuota", { count: d.near_quota }) }] : []),
    ...(d && d.today.errors > 0 ? [{ href: "/platform/health", text: t("alertErrors", { count: d.today.errors }) }] : []),
    ...(d && d.companies.suspended > 0 ? [{ href: "/platform/companies", text: t("alertSuspended", { count: d.companies.suspended }) }] : []),
  ];

  const kpis = d
    ? [
        { label: t("kpiCompanies"), value: n(d.companies.active), sub: t("kpiCompaniesSub", { count: d.companies.new_this_month }) },
        { label: t("kpiPeople"), value: n(d.people.active_today), sub: t("kpiPeopleSub", { week: n(d.people.active_7d), seats: n(d.people.seats) }) },
        { label: t("kpiRequests"), value: n(d.today.requests), sub: t("kpiRequestsSub", { month: n(d.month.requests) }) },
        { label: t("kpiCost"), value: money(costMonthEur), sub: t("kpiCostSub", { today: money(eur(d.today.cost_usd)) }) },
        { label: t("kpiRevenue"), value: money(revenue), sub: margin === null ? t("kpiRevenueNone") : t("kpiMargin", { margin }) },
      ]
    : [];

  const actions = [
    { href: "/platform/companies?new=1", icon: UserPlusIcon, label: t("goInvite") },
    { href: "/platform/releases", icon: RocketIcon, label: t("goLaunch") },
    { href: "/platform/preview", icon: MonitorCheckIcon, label: t("goPreview") },
    { href: "/platform/debug", icon: WrenchIcon, label: t("goDebug") },
    { href: "/platform/companies", icon: BuildingIcon, label: t("goCompanies") },
  ];

  return (
    <PageContainer className="max-w-6xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] capitalize text-muted-foreground">{format.dateTime(new Date(), { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.025em]">{t("hello", { name: ctx.profile.fullName?.split(" ")[0] ?? "" })}</h1>
        </div>
        <Link href="/platform/releases" className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] hover:bg-accent">
          <span className="font-medium">{APP_VERSION}</span>
          {lastCheck ? (
            lastCheck.status === "passed" ? <CircleCheckIcon className="size-4 text-success" aria-label={t("checkOk")} /> : <CircleAlertIcon className="size-4 text-destructive" aria-label={t("checkKo")} />
          ) : null}
        </Link>
      </header>

      <section aria-label={t("numbers")} className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="dashboard-kpis">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-[12px] text-muted-foreground">{k.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{k.value}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">{k.sub}</p>
          </Card>
        ))}
      </section>

      <section className="mt-4" aria-label={t("attention")}>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">
            <CircleCheckIcon className="size-4 text-success" />
            {t("allGood")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <Link key={a.text} href={a.href} className="flex items-center gap-2 rounded-full border border-warning/40 bg-warning-soft px-3 py-1.5 text-[13px] text-warning hover:opacity-90">
                <CircleAlertIcon className="size-4" />
                {a.text}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="deck">
        <h2 id="deck" className="mb-3 text-[13px] font-medium text-muted-foreground">
          {t("deck")}
        </h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-5">
          {actions.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} className="group flex aspect-[4/3] flex-col justify-between rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40">
              <Icon className="size-5 text-brand" />
              <span className="text-sm font-medium">{label}</span>
            </Link>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5" data-testid="deck-tools">
          {externalTools().map((tool) => (
            <a
              key={tool.name}
              href={tool.href}
              target="_blank"
              rel="noreferrer"
              className="group relative flex aspect-[4/3] flex-col justify-between rounded-2xl border bg-card p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40"
            >
              <span className={cn("flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold", tool.color)}>{tool.name.charAt(0)}</span>
              <span>
                <span className="block text-sm font-medium">{tool.name}</span>
                <span className="block text-[12px] text-muted-foreground">{t(`tools.${tool.key}` as "tools.vercel")}</span>
              </span>
              <ArrowUpRightIcon className="absolute right-3 top-3 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
