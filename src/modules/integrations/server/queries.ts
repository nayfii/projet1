import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { canGovernIntegrations, providerAvailability, type ProviderAvailability } from "./access";
import { integrationsConfigured } from "./crypto";

export type ConnectionView = {
  id: string;
  provider: string;
  scope: "personal" | "company";
  ownerId: string;
  ownerName: string | null;
  mine: boolean;
  accountLabel: string | null;
  apps: string[];
  status: "active" | "expired" | "error";
  lastUsedAt: string | null;
  createdAt: string;
};

/** The catalogue: providers and whether they can be connected here, and the connections this person may see. */
export async function integrationsPageData(ctx: MemberContext) {
  const supabase = await createClient();
  const [availability, { data: rows, error }] = await Promise.all([
    providerAvailability(ctx.active.companyId),
    supabase
      .from("integration_connections")
      .select("id, provider, scope, owner_id, account_label, apps, status, last_used_at, created_at")
      .eq("company_id", ctx.active.companyId)
      .neq("status", "revoked")
      .order("created_at"),
  ]);
  const ownerIds = [...new Set((rows ?? []).map((r) => r.owner_id))];
  const { data: profiles } = ownerIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ownerIds) : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const connections: ConnectionView[] = (rows ?? []).map((r) => ({
    id: r.id,
    provider: r.provider,
    scope: r.scope as ConnectionView["scope"],
    ownerId: r.owner_id,
    ownerName: names.get(r.owner_id) ?? null,
    mine: r.owner_id === ctx.user.id,
    accountLabel: r.account_label,
    apps: r.apps,
    status: r.status as ConnectionView["status"],
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  }));
  return {
    // A database without the V1.1 migration (a preview): the page says it is coming.
    ready: !error,
    keyConfigured: integrationsConfigured(),
    availability: availability as ProviderAvailability[],
    connections,
    canGovern: canGovernIntegrations(ctx),
  };
}

/** Connections this person may read files through (picker in the chat and in memories). */
export async function readableConnections(ctx: MemberContext, capability: "search" = "search"): Promise<{ id: string; provider: string; accountLabel: string | null; apps: string[] }[]> {
  void capability;
  const { connections, availability } = await integrationsPageData(ctx);
  const ready = new Set(availability.filter((a) => a.ready).map((a) => a.id as string));
  return connections
    .filter((c) => c.status === "active" && ready.has(c.provider) && (c.mine || c.scope === "company"))
    .filter((c) => c.apps.some((a) => ["drive", "onedrive", "notion"].includes(a)))
    .map((c) => ({ id: c.id, provider: c.provider, accountLabel: c.accountLabel, apps: c.apps }));
}
