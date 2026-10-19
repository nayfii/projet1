/**
 * Monthly credit quotas (CLAUDE.md §5): soft warning at 80 %, hard stop at 100 %,
 * for the company (plan + extra credits) and for the person (if a personal limit is set).
 */
export const QUOTA_WARNING_RATIO = 0.8;

export type QuotaStatus = {
  periodStart: string;
  companyLimit: number;
  companyUsed: number;
  /** Null when no personal limit applies. */
  userLimit: number | null;
  userUsed: number;
};

export type QuotaState = {
  state: "ok" | "warning" | "blocked";
  /** Which limit drives the state (the most constraining one). */
  scope: "company" | "user" | null;
  /** Share of that limit already used, 0..1+ */
  ratio: number;
};

function ratio(used: number, limit: number): number {
  if (limit <= 0) return used > 0 || limit === 0 ? Infinity : 0;
  return used / limit;
}

export function evaluateQuota(status: QuotaStatus): QuotaState {
  const company = ratio(status.companyUsed, status.companyLimit);
  const user = status.userLimit === null ? 0 : ratio(status.userUsed, status.userLimit);
  const scope: "company" | "user" = user > company ? "user" : "company";
  const worst = Math.max(company, user);
  if (worst >= 1) return { state: "blocked", scope, ratio: worst };
  if (worst >= QUOTA_WARNING_RATIO) return { state: "warning", scope, ratio: worst };
  return { state: "ok", scope: null, ratio: worst };
}
