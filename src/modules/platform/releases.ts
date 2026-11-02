/**
 * How our console reads GitHub's state for versions and Claude Code changes (pure, unit-tested).
 */
export type RunLike = { status: string; conclusion: string | null } | null;
export type PullLike = { state: "open" | "closed"; merged: boolean; draft: boolean } | null;

export type RunStatus = "running" | "succeeded" | "failed";

export function runStatus(run: { status: string; conclusion: string | null }): RunStatus {
  if (run.status !== "completed") return "running";
  return run.conclusion === "success" ? "succeeded" : "failed";
}

export type FixStatus = "sending" | "not_sent" | "working" | "ready" | "checks_failed" | "no_change" | "failed" | "accepted" | "rejected";

/** One request to Claude Code: its workflow run (by title) and its pull request (by branch). */
export function fixStatus(run: RunLike, pr: PullLike, createdAt: string, now = Date.now()): FixStatus {
  if (pr?.merged) return "accepted";
  if (pr && pr.state === "closed") return "rejected";
  if (run && run.status !== "completed") return "working";
  if (pr && pr.state === "open") return pr.draft ? "checks_failed" : "ready";
  if (run) return run.conclusion === "success" ? "no_change" : "failed";
  // GitHub takes a few seconds to list a new run.
  return now - new Date(createdAt).getTime() < 3 * 60_000 ? "sending" : "not_sent";
}

/** The workflow run of a request: its title is "Claude Code <request id>". */
export function runTitleFor(requestId: string): string {
  return `Claude Code ${requestId}`;
}
