import "server-only";
import type { MemberContext } from "@/lib/auth/guards";
import { fakeProviderEnabled } from "@/lib/env";
import { listClients } from "@/modules/clients/server/queries";
import { canRestrictClients } from "@/lib/auth/context";
import { defaultChoice, getCompanyModels } from "@/modules/providers/server/models";
import { getMyQuota } from "@/modules/usage/server/quota";
import type { PickerModel } from "../ui/model-picker";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { myMemorySpaces, ownerNamesOf } from "@/modules/memory/server/retrieval";
import { memoryLabel } from "@/modules/memory/labels";
import { getHideSettings } from "@/modules/hide/server/masker";
import { hasScope } from "@/lib/auth/context";

/** What the chat screen needs besides the conversation itself. */
export async function getChatPageData(ctx: MemberContext) {
  const companyId = ctx.active.companyId;
  const supabase = await createClient();
  const [models, clients, quota, spaces, tMemory, hide, { data: membership }, { data: features }] = await Promise.all([
    getCompanyModels(companyId),
    listClients(companyId),
    getMyQuota(companyId),
    myMemorySpaces(supabase, companyId),
    getTranslations("memory"),
    getHideSettings(supabase, companyId),
    supabase.from("company_members").select("team_id").eq("company_id", companyId).eq("user_id", ctx.user.id).maybeSingle(),
    supabase.from("company_ai_settings").select("dictation_enabled, image_generation_enabled").eq("company_id", companyId).maybeSingle(),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const ownerNames = await ownerNamesOf(supabase, spaces.filter((sp) => sp.kind === "team" || sp.kind === "project"));
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
      .filter((sp) => sp.canWrite && (sp.kind !== "client" || clientName.has(sp.clientId!)))
      .map((sp) => ({
        spaceId: sp.spaceId,
        clientId: sp.clientId,
        label:
          sp.kind === "client"
            ? tMemory("clientMemoryNamed", { client: clientName.get(sp.clientId!) ?? "" })
            : memoryLabel(sp.kind, ownerNames.get(sp.spaceId) ?? null, tMemory),
      })),
    fakeMode: fakeProviderEnabled(),
    // Hide: the company's default modes and the categories Automatic masks.
    hide,
    me: { id: ctx.user.id, name: ctx.profile.fullName },
    canRestrictClients: canRestrictClients(ctx.active),
    // Voice dictation (the company can switch it off).
    dictation: features?.dictation_enabled ?? true,
    // Images in the chat (ChatGPT's image model; the company can switch it off).
    images: features?.image_generation_enabled ?? true,
    // "Turn into a tool": what the tool editor needs.
    toolEditor: { models: picker, autoEnabled: models.autoEnabled, hasTeam: Boolean(membership?.team_id), canApprove: hasScope(ctx.active, "agents") },
  };
}
