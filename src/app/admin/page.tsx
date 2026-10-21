import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRightIcon, CheckCircle2Icon, CircleAlertIcon, CircleDotIcon } from "lucide-react";
import { requireCompanyAdmin } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { getCompanyPlan, listMembers, listPendingInvitations } from "@/modules/organizations/server/queries";
import { listClients } from "@/modules/clients/server/queries";
import { getMyQuota } from "@/modules/usage/server/quota";
import { getMemberCredits } from "@/modules/usage/server/queries";
import { QUOTA_WARNING_RATIO } from "@/modules/usage/quota";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminNav");
  return { title: t("title") };
}

type Todo = { key: string; tone: "warning" | "info"; text: string; href: string; action: string };

export default async function AdminOverviewPage() {
  const ctx = await requireCompanyAdmin();
  const t = await getTranslations("adminOverview");
  const companyId = ctx.active.companyId;
  const canMembers = hasScope(ctx.active, "members");
  const canClients = hasScope(ctx.active, "clients");
  const canUsage = hasScope(ctx.active, "usage");
  const canQuotas = hasScope(ctx.active, "quotas");
  const canAgents = hasScope(ctx.active, "agents");
  const canCredits = canUsage || canQuotas;
  const format = await getFormatter();
  const supabase = await createClient();

  const [members, invitations, clients, plan, quota, video, memberCredits, pendingTools] = await Promise.all([
    listMembers(companyId),
    canMembers ? listPendingInvitations(companyId) : Promise.resolve([]),
    canClients ? listClients(companyId) : Promise.resolve([]),
    getCompanyPlan(companyId),
    canCredits ? getMyQuota(companyId) : Promise.resolve(null),
    canCredits ? supabase.rpc("my_video_credits", { p_company: companyId }).then(({ data }) => data?.[0] ?? null) : Promise.resolve(null),
    canCredits ? getMemberCredits(companyId) : Promise.resolve([]),
    canAgents
      ? supabase
          .from("agents")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("visibility", "company")
          .eq("publication", "pending")
          .then(({ count }) => count ?? 0)
      : Promise.resolve(0),
  ]);
  const active = members.filter((m) => m.status === "active");
  const restricted = clients.filter((c) => c.visibility === "restricted").length;
  const percent = (used: number, limit: number) => (limit > 0 ? Math.round((used / limit) * 100) : used > 0 ? 100 : 0);
  const number = (n: number) => format.number(n, { maximumFractionDigits: 0 });

  const videoLimit = video ? Number(video.video_limit) : 0;
  const videoUsed = video ? Number(video.video_used) + Number(video.video_reserved) : 0;

  // What needs the boss's attention now: approvals, limits close to their end, a full team.
  const todos: Todo[] = [];
  if (pendingTools > 0) {
    todos.push({ key: "tools", tone: "info", text: t("todo.tools", { count: pendingTools }), href: "/admin/agents", action: t("todo.review") });
  }
  if (quota && (quota.status.companyLimit <= 0 || quota.status.companyUsed >= quota.status.companyLimit * QUOTA_WARNING_RATIO)) {
    const p = percent(quota.status.companyUsed, quota.status.companyLimit);
    todos.push({ key: "credits", tone: "warning", text: t(p >= 100 ? "todo.creditsOut" : "todo.creditsLow", { percent: p }), href: "/admin/quotas", action: t("todo.quotas") });
  }
  if (video && videoLimit > 0 && videoUsed >= videoLimit * QUOTA_WARNING_RATIO) {
    const p = percent(videoUsed, videoLimit);
    todos.push({ key: "video", tone: "warning", text: t(p >= 100 ? "todo.videoOut" : "todo.videoLow", { percent: p }), href: "/admin/quotas", action: t("todo.quotas") });
  }
  const names = new Map(active.map((m) => [m.userId, m.fullName || m.email]));
  const nearLimit = memberCredits.filter((c) => c.limit !== null && names.has(c.userId) && c.used >= c.limit * QUOTA_WARNING_RATIO);
  if (nearLimit.length > 0) {
    todos.push({
      key: "people",
      tone: "warning",
      text: t("todo.people", { count: nearLimit.length, names: format.list(nearLimit.slice(0, 3).map((c) => names.get(c.userId) ?? "")) }),
      href: "/admin/quotas",
      action: t("todo.quotas"),
    });
  }
  if (canMembers && plan?.seat_limit && active.length >= plan.seat_limit) {
    todos.push({ key: "seats", tone: "info", text: t("todo.seats", { limit: plan.seat_limit }), href: "/admin/members", action: t("todo.members") });
  }

  const stats = [
    {
      label: t("seats"),
      value: plan?.seat_limit ? t("seatsValue", { used: active.length, limit: plan.seat_limit }) : String(active.length),
      hint: canMembers ? t("pendingInvites", { count: invitations.length }) : undefined,
      href: canMembers ? "/admin/members" : undefined,
    },
    ...(canClients
      ? [{ label: t("clients"), value: String(clients.length), hint: t("restrictedCount", { count: restricted }), href: "/admin/clients" }]
      : []),
    ...(quota
      ? [
          {
            label: t("aiCredits"),
            value: t("aiCreditsValue", { used: number(quota.status.companyUsed), limit: number(quota.status.companyLimit) }),
            hint: t("aiCreditsHint", { percent: percent(quota.status.companyUsed, quota.status.companyLimit) }),
            href: canUsage ? "/admin/usage" : "/admin/quotas",
          },
        ]
      : []),
    ...(video
      ? [
          {
            label: t("videoCredits"),
            value: t("aiCreditsValue", { used: number(videoUsed), limit: number(videoLimit) }),
            hint: videoLimit > 0 ? t("aiCreditsHint", { percent: percent(videoUsed, videoLimit) }) : t("videoNone"),
            href: "/admin/quotas",
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t("title")}
        description={t("description", { company: ctx.active.companyName })}
        actions={
          <p className="text-[13px] text-muted-foreground">
            {t("planLine", { plan: plan?.name ?? t("noPlan") })}
          </p>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => {
          const card = (
            <Card className="h-full p-5">
              <p className="text-[13px] text-muted-foreground">{s.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{s.value}</p>
              {s.hint ? <p className="mt-1 text-[13px] text-muted-foreground">{s.hint}</p> : null}
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="group relative rounded-xl">
              {card}
              <ArrowRightIcon className="absolute right-5 top-5 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>

      <section className="mt-10" aria-labelledby="todo-title">
        <h2 id="todo-title" className="text-[15px] font-medium">
          {t("todo.title")}
        </h2>
        {todos.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
            <CheckCircle2Icon className="size-4 text-success" />
            {t("todo.none")}
          </p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border bg-card">
            {todos.map((todo) => (
              <li key={todo.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px]">
                {todo.tone === "warning" ? (
                  <CircleAlertIcon className="size-4 shrink-0 text-warning" />
                ) : (
                  <CircleDotIcon className="size-4 shrink-0 text-brand" />
                )}
                <span className="min-w-0 flex-1">{todo.text}</span>
                <Link href={todo.href} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  {todo.action}
                  <ArrowRightIcon className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
