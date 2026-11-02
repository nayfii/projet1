"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientRow } from "../server/queries";
import { ClientAccessDialog } from "./clients-manager";

/** "Manage access" on a restricted client's page, for client Admins (everyone) and Managers (their team). */
export function ClientAccessButton({
  client,
  members,
  note,
}: {
  client: Pick<ClientRow, "id" | "name" | "assignees">;
  members: { userId: string; name: string }[];
  note?: string;
}) {
  const t = useTranslations("clients");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRoundIcon />
        {t("manageAccess")}
      </Button>
      {open ? (
        <ClientAccessDialog
          client={client}
          members={members}
          note={note}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
