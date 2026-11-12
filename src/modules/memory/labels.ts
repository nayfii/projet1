import type { MemoryKind } from "./types";

/** The translator of a namespace that holds the three memory words below. */
export type MemoryWords = (key: "companyMemory" | "teamLabel" | "projectLabel", values?: { name: string }) => string;

/**
 * How a memory is named everywhere (sources, "memories used", Consciousness, permissions):
 * "Company memory", the client's name, "Team Marketing" or "Project Launch".
 */
export function memoryLabel(kind: MemoryKind | null | undefined, name: string | null, t: MemoryWords): string {
  if (kind === "company") return t("companyMemory");
  if (kind === "team") return t("teamLabel", { name: name ?? "" });
  if (kind === "project") return t("projectLabel", { name: name ?? "" });
  return name ?? "";
}
