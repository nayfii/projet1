import { useTranslations } from "next-intl";
import { GlobeIcon, LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

export function VisibilityBadge({ visibility }: { visibility: "open" | "restricted" }) {
  const t = useTranslations("clients");
  return visibility === "open" ? (
    <Badge variant="neutral">
      <GlobeIcon />
      {t("visibilityOpen")}
    </Badge>
  ) : (
    <Badge variant="warning">
      <LockIcon />
      {t("visibilityRestricted")}
    </Badge>
  );
}

export function AvatarStack({ people, max = 4 }: { people: { userId: string; fullName: string | null; email: string; avatarUrl: string | null }[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((p) => (
        <Avatar key={p.userId} name={p.fullName ?? p.email} src={p.avatarUrl} className="size-6 ring-2 ring-card" />
      ))}
      {rest > 0 ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card">
          {`+${rest}`}
        </span>
      ) : null}
    </div>
  );
}
