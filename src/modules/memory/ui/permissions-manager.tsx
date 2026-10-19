"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BriefcaseIcon, BuildingIcon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, Spinner } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteCategoryAction, saveCategoryAction, setSpaceGrantsAction } from "../server/permissions";

type Category = { id: string; name: string; description: string | null; systemKey: "everyone" | "management" | null; members: string[] };
type Space = { id: string; kind: "company" | "client"; clientName: string | null; read: string[]; write: string[] };
type Member = { userId: string; name: string; role: "owner" | "admin" | "member" };

export function PermissionsManager({ categories, spaces, members }: { categories: Category[]; spaces: Space[]; members: Member[] }) {
  const t = useTranslations("permissions");
  const tErrors = useTranslations("errors");
  const [editingCategory, setEditingCategory] = React.useState<Category | "new" | null>(null);
  const [editingSpace, setEditingSpace] = React.useState<Space | null>(null);
  const [busy, startBusy] = React.useTransition();

  const categoryName = (c: Category) => (c.systemKey ? t(`system.${c.systemKey}`) : c.name);
  // Groups in the same order as the list above (automatic groups first).
  const groupList = (ids: string[]) => categories.filter((c) => ids.includes(c.id)).map(categoryName).join(", ") || t("nobody");
  const spaceName = (s: Space) => (s.kind === "company" ? t("companyMemory") : s.clientName ? t("clientMemory", { client: s.clientName }) : t("restrictedClient"));

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">{t("groupsTitle")}</h2>
            <p className="text-[13px] text-muted-foreground">{t("groupsBody")}</p>
          </div>
          <Button variant="outline" onClick={() => setEditingCategory("new")}>
            <PlusIcon />
            {t("newGroup")}
          </Button>
        </div>
        <Card className="divide-y overflow-hidden">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{categoryName(c)}</p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {c.systemKey ? t(`systemHint.${c.systemKey}`) : (c.description ?? t("membersCount", { count: c.members.length }))}
                </p>
              </div>
              {c.systemKey ? (
                <Badge variant="outline">{t("automatic")}</Badge>
              ) : (
                <>
                  <Badge variant="neutral">{t("membersCount", { count: c.members.length })}</Badge>
                  <Button variant="ghost" size="icon-sm" aria-label={t("editGroup", { name: c.name })} onClick={() => setEditingCategory(c)}>
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("deleteGroup", { name: c.name })}
                    disabled={busy}
                    onClick={() =>
                      startBusy(async () => {
                        const result = await deleteCategoryAction({ categoryId: c.id });
                        if (result.ok) toast.success(t("groupDeleted"));
                        else toast.error(tErrors(result.error));
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </>
              )}
            </div>
          ))}
        </Card>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t("accessTitle")}</h2>
          <p className="text-[13px] text-muted-foreground">{t("accessBody")}</p>
        </div>
        <Card className="divide-y overflow-hidden">
          {spaces.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              {s.kind === "company" ? <BuildingIcon className="size-4 shrink-0 text-brand" /> : <BriefcaseIcon className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{spaceName(s)}</p>
                <p className="text-[13px] text-muted-foreground">
                  {t("readLine", { groups: groupList(s.read) })}
                  {" · "}
                  {t("writeLine", { groups: groupList(s.write) })}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingSpace(s)} aria-label={t("editAccess", { name: spaceName(s) })}>
                <PencilIcon />
                {t("edit")}
              </Button>
            </div>
          ))}
        </Card>
        <p className="text-[13px] text-muted-foreground">{t("ownerNote")}</p>
      </section>

      <CategoryDialog category={editingCategory} members={members} onClose={() => setEditingCategory(null)} />
      <GrantsDialog space={editingSpace} spaceName={editingSpace ? spaceName(editingSpace) : ""} categories={categories} categoryName={categoryName} onClose={() => setEditingSpace(null)} />
    </div>
  );
}

function CategoryDialog({ category, members, onClose }: { category: Category | "new" | null; members: Member[]; onClose: () => void }) {
  const t = useTranslations("permissions");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [saving, startSaving] = React.useTransition();
  const existing = category && category !== "new" ? category : null;

  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{existing ? t("editGroupTitle") : t("newGroup")}</DialogTitle>
          <DialogDescription>{t("groupDialogBody")}</DialogDescription>
        </DialogHeader>
        {category ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              startSaving(async () => {
                const result = await saveCategoryAction({
                  categoryId: existing?.id ?? null,
                  name: String(form.get("name") ?? ""),
                  description: String(form.get("description") ?? ""),
                  members: form.getAll("members").map(String),
                });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                toast.success(t("groupSaved"));
                onClose();
              });
            }}
          >
            <Field label={t("groupName")} htmlFor="group-name">
              <Input id="group-name" name="name" required maxLength={80} defaultValue={existing?.name ?? ""} placeholder={t("groupNamePlaceholder")} autoFocus />
            </Field>
            <Field label={t("groupDescription")} htmlFor="group-description">
              <Input id="group-description" name="description" maxLength={300} defaultValue={existing?.description ?? ""} />
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t("groupMembers")}</legend>
              {members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50">
                  <Checkbox name="members" value={m.userId} defaultChecked={existing?.members.includes(m.userId)} />
                  {m.name}
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GrantsDialog({
  space,
  spaceName,
  categories,
  categoryName,
  onClose,
}: {
  space: Space | null;
  spaceName: string;
  categories: Category[];
  categoryName: (c: Category) => string;
  onClose: () => void;
}) {
  const t = useTranslations("permissions");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [read, setRead] = React.useState<Set<string>>(new Set());
  const [write, setWrite] = React.useState<Set<string>>(new Set());
  const [saving, startSaving] = React.useTransition();
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  if (space && loadedFor !== space.id) {
    setLoadedFor(space.id);
    setRead(new Set(space.read));
    setWrite(new Set(space.write));
  }

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };

  return (
    <Dialog open={space !== null} onOpenChange={(open) => !open && (onClose(), setLoadedFor(null))}>
      <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{spaceName}</DialogTitle>
          <DialogDescription>{space?.kind === "client" ? t("grantsClientBody") : t("grantsCompanyBody")}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>{t("group")}</span>
            <span>{t("canRead")}</span>
            <span>{t("canWrite")}</span>
          </div>
          {categories.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-4 py-2.5 text-sm">
              <span className="truncate">{categoryName(c)}</span>
              <Checkbox
                aria-label={t("readFor", { name: categoryName(c) })}
                checked={read.has(c.id) || write.has(c.id)}
                disabled={write.has(c.id)}
                onCheckedChange={(on) => setRead((r) => toggle(r, c.id, on === true))}
                className="justify-self-center"
              />
              <Checkbox
                aria-label={t("writeFor", { name: categoryName(c) })}
                checked={write.has(c.id)}
                onCheckedChange={(on) => setWrite((w) => toggle(w, c.id, on === true))}
                className="justify-self-center"
              />
            </div>
          ))}
        </div>
        {read.size + write.size === 0 ? <p className="text-[13px] text-warning">{t("nobodyWarning")}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              startSaving(async () => {
                if (!space) return;
                const result = await setSpaceGrantsAction({ spaceId: space.id, read: [...new Set([...read, ...write])], write: [...write] });
                if (!result.ok) {
                  toast.error(tErrors(result.error));
                  return;
                }
                toast.success(t("accessSaved"));
                onClose();
                setLoadedFor(null);
              })
            }
          >
            {saving ? <Spinner /> : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
