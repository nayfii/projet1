import { getLocale } from "next-intl/server";
import { platformAdminOrNull } from "@/lib/auth/guards";
import { getScaleSnapshot } from "@/modules/scale/server/queries";
import { toCsvRows } from "@/modules/scale/logic/export";

export const runtime = "nodejs";

/**
 * Scale's data for our team: everything as JSON (documents included), or the tasks / tests as CSV
 * (opens in Excel). Never customers' content: only Scale's records and company names already shown
 * in our console.
 */
export async function GET(request: Request) {
  const ctx = await platformAdminOrNull();
  if (!ctx) return Response.json({ error: "forbidden" }, { status: 403 });
  const format = new URL(request.url).searchParams.get("format");
  const snap = await getScaleSnapshot(ctx);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = (type: string, name: string) => ({ "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });

  if (format === "json") {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: documents } = await supabase.from("scale_documents").select("*");
    const { team, companies, computed, meId, recent, ...records } = snap;
    void meId;
    void recent;
    void computed;
    const body = { exported_at: new Date().toISOString(), ...records, documents: documents ?? [], team: team.map((m) => ({ id: m.id, name: m.name })), companies: companies.map((c) => ({ id: c.id, name: c.name })) };
    return new Response(JSON.stringify(body, null, 2), { headers: headers("application/json; charset=utf-8", `scale-${stamp}.json`) });
  }

  const separator = (await getLocale()) === "fr" ? ";" : ",";
  const person = new Map(snap.team.map((m) => [m.id, m.name]));
  const project = new Map(snap.projects.map((p) => [p.id, p.title]));
  if (format === "tasks") {
    const rows = snap.tasks.map((x) => ({
      id: x.id,
      title: x.title,
      status: x.status,
      priority: x.priority,
      kind: x.kind,
      project: x.project_id ? (project.get(x.project_id) ?? "") : "",
      owner: x.owner_id ? (person.get(x.owner_id) ?? "") : "",
      start_date: x.start_date ?? "",
      due_date: x.due_date ?? "",
      week_start: x.week_start ?? "",
      estimate_hours: x.estimate_hours ?? "",
      archived: x.archived_at ? "yes" : "",
      description: x.description ?? "",
    }));
    return new Response(toCsvRows(rows, separator), { headers: headers("text/csv; charset=utf-8", `scale-tasks-${stamp}.csv`) });
  }
  if (format === "tests") {
    const rows = snap.tests.map((x) => ({
      id: x.id,
      title: x.title,
      category: x.category ?? "",
      status: x.status,
      conclusion: x.conclusion ?? "",
      hypothesis: x.hypothesis ?? "",
      success_criterion: x.success_criterion ?? "",
      start_date: x.start_date ?? "",
      end_date: x.end_date ?? "",
      results: x.results ?? "",
      limits: x.limits ?? "",
      next_actions: x.next_actions ?? "",
      project: x.project_id ? (project.get(x.project_id) ?? "") : "",
    }));
    return new Response(toCsvRows(rows, separator), { headers: headers("text/csv; charset=utf-8", `scale-tests-${stamp}.csv`) });
  }
  return Response.json({ error: "validation" }, { status: 400 });
}
