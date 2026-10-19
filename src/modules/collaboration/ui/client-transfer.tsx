"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRightLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Colleague } from "../server/queries";
import { TransferDialog } from "./transfer-dialog";

/** "Transférer ce client": an employee assigned to a restricted client hands it over (Smart Handover). */
export function ClientTransferButton({ client, colleagues }: { client: { id: string; name: string }; colleagues: Colleague[] }) {
  const t = useTranslations("collaboration");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ArrowRightLeftIcon />
        {t("transferClient")}
      </Button>
      <TransferDialog
        open={open}
        onOpenChange={setOpen}
        target={{ kind: "client", id: client.id, name: client.name }}
        colleagues={colleagues}
        onTransferred={() => {
          router.push("/clients");
          router.refresh();
        }}
      />
    </>
  );
}
