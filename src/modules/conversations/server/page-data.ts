import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { fakeProviderEnabled } from "@/lib/env";
import { listClients } from "@/modules/clients/server/queries";
import { defaultChoice, getCompanyModels } from "@/modules/providers/server/models";
import { getMyQuota } from "@/modules/usage/server/quota";
import type { PickerModel } from "../ui/model-picker";

/** What the chat screen needs besides the conversation itself. */
export async function getChatPageData(ctx: MemberContext) {
  const companyId = ctx.active.companyId;
  const [models, clients, quota] = await Promise.all([getCompanyModels(companyId), listClients(companyId), getMyQuota(companyId)]);
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
    fakeMode: fakeProviderEnabled(),
  };
}
