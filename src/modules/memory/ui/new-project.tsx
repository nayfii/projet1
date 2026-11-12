"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createProjectAction } from "../server/project-actions";

const NO_CLIENT = "none";

/** "New project": a name, optionally a client and a goal; opens the project's memory once created. */
export function NewProjectButton({ clients }: { clients: { id: string; name: string }[] }) {
  const t = useTranslations("memory");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [clientId, setClientId] = React.useState(NO_CLIENT);
  const [pending, startTransition] = React.useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createProjectAction({ name, description, clientId: clientId === NO_CLIENT ? null : clientId });
      if (!result.ok) {
        toast.error(tErrors(result.error));
        return;
      }
      toast.success(t("projectCreated"));
      setOpen(false);
      if (result.data) router.push(`/memory/${result.data.spaceId}`);
    });
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("newProject")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("newProject")}</DialogTitle>
            <DialogDescription>{t("projectHint")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">{t("projectName")}</Label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-client">{t("projectClient")}</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="project-client">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>{t("noClient")}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">{t("projectDescription")}</Label>
              <Input id="project-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending || !name.trim()}>
                {t("createProject")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
