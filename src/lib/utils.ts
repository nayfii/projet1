import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Initials for avatars: "Nathalie Dupont" → "ND", "olivier@x.fr" → "O". */
export function initials(nameOrEmail: string | null | undefined): string {
  const source = (nameOrEmail ?? "").trim();
  if (!source) return "?";
  const base = source.includes("@") && !source.includes(" ") ? source.split("@")[0] : source;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0];
  return letters.toUpperCase();
}
