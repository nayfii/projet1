"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BuildingIcon, FlaskConicalIcon, KanbanIcon, ListIcon, PlusIcon, UsersIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TEST_TEMPLATES } from "../templates";
import { CONCLUSIONS, TEST_CATEGORIES, TEST_STATUSES, type Conclusion, type Test, type TestCategory, type TestStatus } from "../types";
import { ChoiceMenu, ScalePageHeader, Segmented, useDates } from "./primitives";
import { useIndex } from "./selectors";
import { usePanel, usePref, useScale, useScaleActions } from "./store";

const STATUS_DOT: Record<TestStatus, string> = {
  to_prepare: "bg-muted-foreground/40",
  ready: "bg-muted-foreground",
  running: "bg-warning",
  to_analyze: "bg-foreground",
  done: "bg-success",
  abandoned: "bg-muted-foreground/30",
};

export function TestStatusBadge({ status }: { status: TestStatus }) {
  const t = useTranslations("scale.testStatus");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {t(status)}
    </span>
  );
}

/** The conclusion is its own thing: never deduced from the status. */
export function ConclusionBadge({ conclusion }: { conclusion: Conclusion | null }) {
  const t = useTranslations("scale.conclusion");
  if (!conclusion) return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("none")}</span>;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium",
        conclusion === "supported" ? "bg-success-soft text-success" : conclusion === "not_supported" ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning",
      )}
    >
      {t(conclusion)}
    </span>
  );
}

type Filters = { status: TestStatus | null; category: TestCategory | null; conclusion: Conclusion | "none" | null };

export function TestsPage() {
  const t = useTranslations("scale");
  const index = useIndex();
  const [tab, setTab] = usePref<"tests" | "customers">("tests-tab", "tests");
  const [layout, setLayout] = usePref<"board" | "list">("tests-layout", "board");
  const [f, setF] = usePref<Filters>("tests-filters", { status: null, category: null, conclusion: null });
  const tests = index.tests.filter((x) => (!f.status || x.status === f.status) && (!f.category || x.category === f.category) && (!f.conclusion || (f.conclusion === "none" ? !x.conclusion : x.conclusion === f.conclusion)));

  return (
    <div className="mx-auto w-full max-w-[84rem] px-4 py-8 sm:px-8 sm:py-10">
      <ScalePageHeader title={t("tests.title")} description={t("tests.description")} actions={<NewTestMenu />} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          label={t("tests.tabs.label")}
          options={[
            { value: "tests", label: t("tests.tabs.tests"), icon: <FlaskConicalIcon /> },
            { value: "customers", label: t("tests.tabs.customers"), icon: <UsersIcon /> },
          ]}
        />
        {tab === "tests" ? (
          <div className="flex flex-wrap items-center gap-1">
            <ChoiceMenu value={f.status} options={TEST_STATUSES} label={(s) => t(`testStatus.${s}`)} onChange={(status) => setF({ ...f, status })} allowNone noneLabel={t("tests.allStatuses")} ariaLabel={t("fields.status")} className="h-8 border text-xs" />
            <ChoiceMenu value={f.category} options={TEST_CATEGORIES} label={(c) => t(`category.${c}`)} onChange={(category) => setF({ ...f, category })} allowNone noneLabel={t("tests.allCategories")} ariaLabel={t("fields.category")} className="h-8 border text-xs" />
            <ChoiceMenu value={f.conclusion} options={[...CONCLUSIONS, "none"] as const} label={(c) => t(`conclusion.${c}`)} onChange={(conclusion) => setF({ ...f, conclusion })} allowNone noneLabel={t("tests.allConclusions")} ariaLabel={t("fields.conclusion")} className="h-8 border text-xs" />
            <Segmented value={layout} onChange={setLayout} label={t("tests.layout")} options={[{ value: "board", label: t("tests.board"), icon: <KanbanIcon /> }, { value: "list", label: t("tests.list"), icon: <ListIcon /> }]} />
          </div>
        ) : null}
      </div>
      {tab === "customers" ? (
        <CustomersView />
      ) : index.tests.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
          <FlaskConicalIcon className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 font-medium">{t("tests.emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("tests.emptyText")}</p>
          <div className="mt-4 flex justify-center">
            <NewTestMenu />
          </div>
        </div>
      ) : layout === "board" ? (
        <TestsBoard tests={tests} />
      ) : (
        <TestsList tests={tests} />
      )}
    </div>
  );
}

export function NewTestMenu({ projectId = null }: { projectId?: string | null }) {
  const t = useTranslations("scale.tests");
  const actions = useScaleActions();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <PlusIcon />
          {t("new")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("fromTemplate")}</DropdownMenuLabel>
        {TEST_TEMPLATES.map((k) => (
          <DropdownMenuItem
            key={k}
            onSelect={async () => {
              const row = await actions.createTestFromTemplate(k, projectId);
              if (row) router.push(`/scale/tests/${row.id}`);
            }}
          >
            <span className="min-w-0">
              <span className="block">{t(`templates.${k}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`templateHints.${k}`)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            const row = await actions.create("test", { title: t("untitled"), ...(projectId ? { project_id: projectId } : {}) });
            if (row) router.push(`/scale/tests/${row.id}`);
          }}
        >
          {t("blank")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TestCard({ test }: { test: Test }) {
  const t = useTranslations("scale");
  const index = useIndex();
  const dates = useDates();
  const owner = test.owner_id ? index.personById.get(test.owner_id) : null;
  const customers = (index.linksByEntity.get(`test:${test.id}`) ?? []).length;
  return (
    <Link href={`/scale/tests/${test.id}`} className="block rounded-xl border bg-card p-3.5 shadow-xs outline-none transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{test.title}</p>
        {owner ? <Avatar name={owner.name} className="size-5 shrink-0 text-[9px]" /> : null}
      </div>
      {test.hypothesis ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{test.hypothesis}</p> : <p className="mt-1 text-xs italic text-muted-foreground/70">{t("tests.noHypothesis")}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {test.category ? <span className="rounded-full bg-muted px-2 py-0.5">{t(`category.${test.category}`)}</span> : null}
        {test.status === "done" || test.status === "to_analyze" || test.conclusion ? <ConclusionBadge conclusion={test.conclusion as Conclusion | null} /> : null}
        {test.end_date ? <span>{dates.short(test.end_date)}</span> : null}
        {customers ? (
          <span className="inline-flex items-center gap-1">
            <BuildingIcon className="size-3" />
            {customers}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function TestsBoard({ tests }: { tests: Test[] }) {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const [drag, setDrag] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<TestStatus | null>(null);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
      <div className="flex min-w-max gap-3">
        {TEST_STATUSES.map((status) => {
          const items = tests.filter((x) => x.status === status);
          return (
            <section
              key={status}
              aria-label={t(`testStatus.${status}`)}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = drag ?? e.dataTransfer.getData("text/plain");
                setDrag(null);
                setOver(null);
                if (id) void actions.update("test", id, { status });
              }}
              className={cn("w-[16.5rem] shrink-0 rounded-2xl bg-muted/40 p-2 transition-colors", over === status && "bg-accent ring-2 ring-ring/30")}
            >
              <h2 className="flex items-center gap-2 px-2 py-1.5 text-[13px] font-medium">
                <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOT[status])} />
                {t(`testStatus.${status}`)} <span className="tabular-nums text-muted-foreground">{items.length}</span>
              </h2>
              <div className="flex min-h-20 flex-col gap-1.5">
                {items.map((x) => (
                  <div
                    key={x.id}
                    draggable
                    onDragStart={(e) => {
                      setDrag(x.id);
                      e.dataTransfer.setData("text/plain", x.id);
                    }}
                    onDragEnd={() => setDrag(null)}
                    className={cn(drag === x.id && "opacity-50")}
                  >
                    <TestCard test={x} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TestsList({ tests }: { tests: Test[] }) {
  const t = useTranslations("scale");
  const actions = useScaleActions();
  const dates = useDates();
  if (!tests.length) return <p className="text-sm text-muted-foreground">{t("tests.noMatch")}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t("fields.title")}</th>
            <th className="px-2 py-2 font-medium">{t("fields.category")}</th>
            <th className="px-2 py-2 font-medium">{t("fields.status")}</th>
            <th className="px-2 py-2 font-medium">{t("fields.conclusion")}</th>
            <th className="px-2 py-2 font-medium">{t("tests.datesCol")}</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((x) => (
            <tr key={x.id} className="border-t hover:bg-accent/40">
              <td className="max-w-[22rem] px-3 py-2">
                <Link href={`/scale/tests/${x.id}`} className="block truncate font-medium hover:underline">
                  {x.title}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{x.hypothesis ?? "—"}</span>
              </td>
              <td className="px-2 py-2 text-xs">{x.category ? t(`category.${x.category}`) : "—"}</td>
              <td className="px-2 py-2">
                <ChoiceMenu value={x.status as TestStatus} options={TEST_STATUSES} label={(s) => t(`testStatus.${s}`)} onChange={(s) => s && void actions.update("test", x.id, { status: s })} ariaLabel={t("fields.status")} />
              </td>
              <td className="px-2 py-2">
                <ConclusionBadge conclusion={x.conclusion as Conclusion | null} />
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground">{[x.start_date, x.end_date].filter(Boolean).map((d) => dates.short(d!)).join(" → ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Customers linked to Scale (pilots, test participants, feedback): ids of existing companies only. */
function CustomersView() {
  const t = useTranslations("scale");
  const data = useScale();
  const index = useIndex();
  const panel = usePanel();
  const companies = [...index.linksByCompany.keys()].map((id) => ({ company: index.companyById.get(id), links: index.linksByCompany.get(id)! })).filter((x) => x.company);
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">{t("companies.intro")}</p>
      {companies.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">{data.companies.length ? t("companies.noneLinked") : t("companies.noCompanies")}</div> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {companies.map(({ company, links }) => (
          <button key={company!.id} type="button" onClick={() => panel.open("company", company!.id)} className="rounded-2xl border bg-card p-4 text-left shadow-xs transition-colors hover:border-foreground/20">
            <p className="flex items-center gap-2 font-medium">
              <BuildingIcon className="size-4 text-muted-foreground" />
              {company!.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {links.some((l) => l.role === "pilot") ? `${t("companies.roles.pilot")} · ` : ""}
              {t("companies.inScale", { count: links.length })}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
