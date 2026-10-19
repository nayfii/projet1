/** Management areas an Owner can delegate to an Admin. Mirrors private.valid_admin_scopes() in SQL. */
export const ADMIN_SCOPES = [
  "company",
  "members",
  "clients",
  "permissions",
  "models",
  "agents",
  "hide",
  "usage",
  "quotas",
  "activity",
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];

/** Scopes whose admin screens exist today. The others are shown as "Coming soon". */
export const AVAILABLE_SCOPES: readonly AdminScope[] = ["company", "members", "clients", "permissions", "models", "hide", "usage", "quotas", "activity"];

export type CompanyRole = "owner" | "admin" | "member";

export function isAdminScope(value: string): value is AdminScope {
  return (ADMIN_SCOPES as readonly string[]).includes(value);
}
