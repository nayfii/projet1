"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArchiveIcon, ArchiveRestoreIcon, BriefcaseIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientRow } from "../server/queries";
import { deleteClientAction, setClientAssignmentAction, updateClientAction } from "../server/actions";
import { ClientForm } from "./client-form";
import { AvatarStack } from "./client-badges";

type Member = { userId: string; name: string };

export function ClientsManager({
  header,
  clients,
  members,
  startWithNew,
  isOwner,
}: {
  header: { title: string; description: string };
  clients: ClientRow[];
  members: Member[];
  startWithNew: boolean;
  isOwner: boolean;
}) {
  const t = useTranslations("clients");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [creating, setCreating] = useState(startWithNew);
  const [assigning, setAssigning] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState<ClientRow | null>(null);
  const [pending, startTransition] = useTransition();

  const update = (input: Parameters<typeof updateClientAction>[0], success: string) =>
    startTransition(async () => {
      const result = await updateClientAction(input);
      if (result.ok) toast.success(success);
      else toast.error(tErrors(result.error));
    });

  const active = clients.filter((c) => !c.archivedAt);
  const archived = clients.filter((c) => c.archivedAt);

  return (
    <div className="space-y-8">
      <PageHeader
        className="pb-0"
        title={header.title}
        description={header.description}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon />
            {t("add")}
          </Button>
        }
      />

      {active.length === 0 ? (
        <EmptyState icon={<BriefcaseIcon />} title={t("emptyTitle")} description={t("emptyManager")} />
      ) : (
        <Card className="divide-y overflow-hidden">
          {active.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                {c.sector ? <p className="truncate text-[13px] text-muted-foreground">{c.sector}</p> : null}
              </div>
              {c.visibility === "restricted" ? (
                <button
                  type="button"
                  onClick={() => setAssigning(c)}
                  className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-accent"
                >
                  {c.assignees.length > 0 ? <AvatarStack people={c.assignees} /> : <UsersIcon className="size-4" />}
                  {t("assignedCount", { count: c.assignees.length })}
                </button>
              ) : null}
              <Select
                value={c.visibility}
                disabled={pending}
                onValueChange={(v) =>
                  update({ clientId: c.id, visibility: v as "open" | "restricted" }, t("visibilityUpdated"))
                }
              >
                <SelectTrigger className="h-8 w-40 text-[13px]" aria-label={t("visibility")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t("visibilityOpen")}</SelectItem>
                  <SelectItem value="restricted">{t("visibilityRestricted")}</SelectItem>
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t("actions")}>
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setAssigning(c)} disabled={c.visibility !== "restricted"}>
                    <UsersIcon />
                    {t("manageAccess")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => update({ clientId: c.id, archived: true }, t("archivedToast"))}>
                    <ArchiveIcon />
                    {t("archive")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Card>
      )}

      {archived.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("archivedTitle")}</h2>
          <Card className="divide-y overflow-hidden">
            {archived.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{c.name}</p>
                <Badge variant="outline">{t("archivedBadge")}</Badge>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => update({ clientId: c.id, archived: false }, t("restoredToast"))}>
                  <ArchiveRestoreIcon />
                  {t("restore")}
                </Button>
                {isOwner ? (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setDeleting(c)}>
                    <Trash2Icon />
                    {t("deleteForGood")}
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("newTitle")}</DialogTitle>
          </DialogHeader>
          <ClientForm
            members={members}
            submitLabel={t("create")}
            onCreated={() => {
              setCreating(false);
              toast.success(t("createdToast"));
              router.replace("/admin/clients");
            }}
          />
        </DialogContent>
      </Dialog>

      {assigning ? (
        <ClientAccessDialog
          client={assigning}
          members={members}
          onClose={() => setAssigning(null)}
        />
      ) : null}
      {deleting ? <DeleteClientDialog client={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}

/** Permanent deletion of an archived client: the Owner retypes its name (CLAUDE.md §11). */
function DeleteClientDialog({ client, onClose }: { client: ClientRow; onClose: () => void }) {
  const t = useTranslations("clients");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = name.trim().toLowerCase() === client.name.trim().toLowerCase();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: client.name })}</DialogTitle>
          <DialogDescription>{t("deleteDescription")}</DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm">
          <span className="text-muted-foreground">{t("deleteTypeName", { name: client.name })}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-label={t("deleteTypeName", { name: client.name })} />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteClientAction({ clientId: client.id, confirmName: name });
                if (result.ok) {
                  toast.success(t("deletedToast"));
                  onClose();
                } else toast.error(tErrors(result.error));
              })
            }
          >
            {t("deleteConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who may open a restricted client. Client Admins see everyone; a Manager sees their own team. */
export function ClientAccessDialog({
  client,
  members,
  note,
  onClose,
}: {
  client: Pick<ClientRow, "id" | "name" | "assignees">;
  members: Member[];
  note?: string;
  onClose: () => void;
}) {
  const t = useTranslations("clients");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [assigned, setAssigned] = useState(new Set(client.assignees.map((a) => a.userId)));
  const [pending, startTransition] = useTransition();

  const toggle = (userId: string, value: boolean) =>
    startTransition(async () => {
      const result = await setClientAssignmentAction({ clientId: client.id, userId, assigned: value });
      if (result.ok) {
        setAssigned((prev) => {
          const next = new Set(prev);
          if (value) next.add(userId);
          else next.delete(userId);
          return next;
        });
      } else toast.error(tErrors(result.error));
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("accessTitle", { name: client.name })}</DialogTitle>
          <DialogDescription>{t("accessDescription")}</DialogDescription>
        </DialogHeader>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noAssigneesYet")}</p>
        ) : (
          <div className="grid max-h-72 gap-2.5 overflow-y-auto">
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={assigned.has(m.userId)} disabled={pending} onCheckedChange={(v) => toggle(m.userId, v === true)} />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">{note ?? t("transferLater")}</p>
        <DialogFooter>
          <Button onClick={onClose}>{tCommon("done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
