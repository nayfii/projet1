import type { MemoryKind } from "@/modules/memory/types";
import type { ImportLevel } from "./types";

/** Where an imported piece of knowledge can go: the person's own memory, or a memory they may write in. */
export type ImportDestination = { id: string; kind: "personal" | MemoryKind; name: string | null };

export const PERSONAL = "personal";

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The destination proposed for a piece of knowledge. Anything the analysis is unsure about, or that
 * points to a memory the person cannot write in, stays personal: sharing it is the person's choice.
 */
export function defaultDestination(level: ImportLevel, target: string | null, destinations: ImportDestination[]): string {
  const find = (kind: MemoryKind, name?: string | null) => {
    const candidates = destinations.filter((d) => d.kind === kind);
    if (name === undefined) return candidates[0]?.id;
    const wanted = fold(name ?? "");
    if (!wanted) return undefined;
    return (candidates.find((d) => fold(d.name ?? "") === wanted) ?? candidates.find((d) => wanted.length >= 3 && fold(d.name ?? "").includes(wanted)))?.id;
  };
  switch (level) {
    case "team":
      return find("team") ?? PERSONAL;
    case "company":
      return find("company") ?? PERSONAL;
    case "client":
      return find("client", target) ?? PERSONAL;
    case "project":
      return find("project", target) ?? PERSONAL;
    default:
      return PERSONAL;
  }
}
