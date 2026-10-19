"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Month picker for the usage dashboard (updates ?period=YYYY-MM). */
export function PeriodSelect({ value, options, label }: { value: string; options: { value: string; label: string }[]; label: string }) {
  const router = useRouter();
  return (
    <Select value={value} onValueChange={(v) => router.push(`?period=${v}`)}>
      <SelectTrigger className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
