import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { hasScope } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { getCompanyModels } from "@/modules/providers/server/models";
import { listClients } from "@/modules/clients/server/queries";
import type { ToolEditorContext } from "../ui/turn-into-tool-dialog";

/** What the tool editor needs: the company's models, whether the person has a team, may approve. */
export async function getToolEditorContext(ctx: MemberContext): Promise<ToolEditorContext> {
  const supabase = await createClient();
  const [models, { data: membership }] = await Promise.all([
    getCompanyModels(ctx.active.companyId),
    supabase.from("company_members").select("team_id").eq("company_id", ctx.active.companyId).eq("user_id", ctx.user.id).maybeSingle(),
  ]);
  return {
    models: models.allowed.map((m) => ({ id: m.id, provider: m.provider, label: m.label, tier: m.tier, available: models.configured.has(m.provider) })),
    autoEnabled: models.autoEnabled,
    hasTeam: Boolean(membership?.team_id),
    canApprove: hasScope(ctx.active, "agents"),
  };
}

/** Clients this person can work on (a "client" field of a tool offers only these). */
export async function reachableClients(ctx: MemberContext): Promise<{ id: string; name: string }[]> {
  const clients = await listClients(ctx.active.companyId);
  return clients
    .filter((c) => c.visibility === "open" || ctx.active.role === "owner" || c.assignees.some((a) => a.userId === ctx.user.id))
    .map((c) => ({ id: c.id, name: c.name }));
}
