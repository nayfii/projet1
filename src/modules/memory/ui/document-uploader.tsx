"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/form";
import { DOCUMENT_ACCEPT, DOCUMENT_EXTENSIONS, extensionOf, MAX_DOCUMENT_BYTES } from "@/modules/documents/file-types";

const KNOWN_ERRORS = ["attachment_type", "document_too_large", "upload_failed", "quota_exceeded_user", "quota_exceeded_company", "forbidden"] as const;

/** Adds documents to a memory. The server reads and indexes them after the upload (status shown in the list). */
export function DocumentUploader({
  spaceId,
  onUploaded,
  variant = "outline",
}: {
  spaceId: string;
  onUploaded?: () => void;
  variant?: "outline" | "default" | "brand";
}) {
  const t = useTranslations("memory");
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const ext = extensionOf(file.name);
      if (!ext || !(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
        toast.error(t("uploadErrors.attachment_type", { name: file.name }));
        continue;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        toast.error(t("uploadErrors.document_too_large", { name: file.name }));
        continue;
      }
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/memory/${spaceId}/documents`, { method: "POST", body: form }).catch(() => null);
      if (!response?.ok) {
        const body = (await response?.json().catch(() => null)) as { error?: string } | null;
        const code = (KNOWN_ERRORS as readonly string[]).includes(body?.error ?? "") ? (body!.error as (typeof KNOWN_ERRORS)[number]) : "upload_failed";
        toast.error(t(`uploadErrors.${code}`, { name: file.name }));
        continue;
      }
      toast.success(t("uploaded", { name: file.name }));
    }
    setBusy(false);
    onUploaded?.();
  }

  return (
    <>
      <Button variant={variant} onClick={() => input.current?.click()} disabled={busy}>
        {busy ? <Spinner /> : <UploadIcon />}
        {t("addDocument")}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        data-testid="memory-document-input"
        onChange={(e) => {
          void upload(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
