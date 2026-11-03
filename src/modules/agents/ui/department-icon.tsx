import {
  BriefcaseBusinessIcon,
  HandshakeIcon,
  HeadsetIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  MegaphoneIcon,
  ReceiptIcon,
  ScaleIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, { icon: LucideIcon; tint: string }> = {
  marketing: { icon: MegaphoneIcon, tint: "bg-[var(--pastel-peach)]/18 text-[var(--pastel-peach)]" },
  sales: { icon: HandshakeIcon, tint: "bg-[var(--pastel-mint)]/18 text-[var(--pastel-mint)]" },
  accounting: { icon: ReceiptIcon, tint: "bg-[var(--pastel-sky)]/18 text-[var(--pastel-sky)]" },
  finance: { icon: LineChartIcon, tint: "bg-[var(--pastel-lavender)]/18 text-[var(--pastel-lavender)]" },
  hr: { icon: UsersIcon, tint: "bg-[var(--pastel-peach)]/18 text-[var(--pastel-peach)]" },
  legal: { icon: ScaleIcon, tint: "bg-[var(--pastel-pearl)]/18 text-foreground/80" },
  customer_service: { icon: HeadsetIcon, tint: "bg-[var(--pastel-mint)]/18 text-[var(--pastel-mint)]" },
  management: { icon: LayoutDashboardIcon, tint: "bg-[var(--pastel-sky)]/18 text-[var(--pastel-sky)]" },
  general: { icon: SparklesIcon, tint: "bg-brand/15 text-brand" },
};

/** The small coloured tile of an app, by department. */
export function DepartmentIcon({ department, className }: { department: string; className?: string }) {
  const { icon: Icon, tint } = ICONS[department] ?? { icon: BriefcaseBusinessIcon, tint: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", tint, className)} aria-hidden>
      <Icon className="size-[18px]" />
    </span>
  );
}
