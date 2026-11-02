"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientForm } from "./client-form";

/**
 * Creates a client from anywhere (sidebar, clients page, chat). Opens the new client's page, or
 * hands its id back (the chat links the conversation to it).
 */
export function NewClientDialog({
  open,
  onOpenChange,
  canRestrict,
  defaultName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestrict: boolean;
  defaultName?: string;
  onCreated?: (id: string) => void;
}) {
  const t = useTranslations("clients");
  const tCommon = useTranslations("common");
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("adminDescription")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ClientForm
            key={defaultName ?? ""}
            members={[]}
            showAssignees={false}
            canRestrict={canRestrict}
            defaultName={defaultName}
            submitLabel={t("create")}
            onCreated={(id) => {
              toast.success(t("createdToast"));
              onOpenChange(false);
              if (onCreated) onCreated(id);
              else router.push(`/clients/${id}`);
              router.refresh();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
