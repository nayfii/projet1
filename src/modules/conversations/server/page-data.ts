import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { fakeProviderEnabled } from "@/lib/env";
import { listClients } from "@/modules/clients/server/queries";
import { defaultChoice, getCompanyModels } from "@/modules/providers/server/models";
import { getMyQuota } from "@/modules/usage/server/quota";
import type { PickerModel } from "../ui/model-picker";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { myMemorySpaces } from "@/modules/memory/server/retrieval";
import { getHideSettings } from "@/modules/hide/server/masker";

/** What the chat screen needs besides the conversation itself. */
export async function getChatPageData(ctx: MemberContext) {
  const companyId = ctx.active.companyId;
  const supabase = await createClient();
  const [models, clients, quota, spaces, tMemory, hide] = await Promise.all([
    getCompanyModels(companyId),
    listClients(companyId),
    getMyQuota(companyId),
    myMemorySpaces(supabase, companyId),
    getTranslations("memory"),
    getHideSettings(supabase, companyId),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const picker: PickerModel[] = models.allowed.map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label,
    tier: m.tier,
    available: models.configured.has(m.provider),
  }));
  return {
    models: picker,
    autoEnabled: models.autoEnabled,
    defaultChoice: defaultChoice(models),
    // Only clients the user can work on (an Admin may see restricted clients' names without access).
    clients: clients
      .filter((c) => c.visibility === "open" || ctx.active.role === "owner" || c.assignees.some((a) => a.userId === ctx.user.id))
      .map((c) => ({ id: c.id, name: c.name })),
    quota: quota?.state ?? null,
    // Memories this person can write into ("Save to memory").
    memoryTargets: spaces
      .filter((sp) => sp.canWrite && (sp.kind === "company" || clientName.has(sp.clientId!)))
      .map((sp) => ({
        spaceId: sp.spaceId,
        clientId: sp.clientId,
        label: sp.kind === "company" ? tMemory("companyMemory") : tMemory("clientMemoryNamed", { client: clientName.get(sp.clientId!) ?? "" }),
      })),
    fakeMode: fakeProviderEnabled(),
    // Hide: the company's default modes and the categories Automatic masks.
    hide,
    me: { id: ctx.user.id, name: ctx.profile.fullName },
  };
}
