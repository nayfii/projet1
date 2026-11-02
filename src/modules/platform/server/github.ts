import "server-only";
import { releaseConfig } from "@/lib/env";

/**
 * The few GitHub calls our console makes (versions, checks, Claude Code changes). The token stays on
 * the server; errors are reduced to a code, never logged with the token or a response body.
 */
export type GitHubError = "not_configured" | "forbidden" | "not_found" | "conflict" | "unavailable";
export type GitHubResult<T> = { ok: true; data: T } | { ok: false; error: GitHubError };

export function githubConfigured(): boolean {
  return Boolean(releaseConfig().token);
}

async function gh<T>(path: string, init?: { method?: string; body?: unknown }): Promise<GitHubResult<T>> {
  const { token, repository } = releaseConfig();
  if (!token) return { ok: false, error: "not_configured" };
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "unavailable" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: "forbidden" };
  if (response.status === 404) return { ok: false, error: "not_found" };
  if (response.status === 405 || response.status === 409 || response.status === 422) return { ok: false, error: "conflict" };
  if (!response.ok) return { ok: false, error: "unavailable" };
  return { ok: true, data: (response.status === 204 ? null : await response.json()) as T };
}

export type WorkflowFile = "release.yml" | "verify.yml" | "claude-fix.yml";

export async function dispatchWorkflow(file: WorkflowFile, inputs: Record<string, string>): Promise<GitHubResult<null>> {
  return gh<null>(`/actions/workflows/${file}/dispatches`, { method: "POST", body: { ref: releaseConfig().sourceBranch, inputs } });
}

export type WorkflowRun = {
  id: number;
  title: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "cancelled" | "skipped" | null | string;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export async function listWorkflowRuns(file: WorkflowFile, perPage = 10): Promise<GitHubResult<WorkflowRun[]>> {
  type Raw = { workflow_runs: { id: number; display_title: string; status: string; conclusion: string | null; created_at: string; updated_at: string; html_url: string }[] };
  const result = await gh<Raw>(`/actions/workflows/${file}/runs?per_page=${perPage}`);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.workflow_runs.map((r) => ({
      id: r.id,
      title: r.display_title,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
    })),
  };
}

export type Change = { sha: string; title: string; date: string };

/** What the next launch would publish: commits on the development branch not yet in production. */
export async function pendingChanges(): Promise<GitHubResult<{ firstRelease: boolean; changes: Change[] }>> {
  const { sourceBranch, releaseBranch } = releaseConfig();
  type Commit = { sha: string; commit: { message: string; committer: { date: string } | null }; parents: unknown[] };
  const toChanges = (commits: Commit[]) =>
    commits
      .filter((c) => c.parents.length < 2)
      .map((c) => ({ sha: c.sha.slice(0, 7), title: c.commit.message.split("\n")[0].slice(0, 160), date: c.commit.committer?.date ?? "" }))
      .filter((c) => !/^Release v\d+\.\d+$/.test(c.title));
  const compare = await gh<{ commits: Commit[] }>(`/compare/${encodeURIComponent(releaseBranch)}...${encodeURIComponent(sourceBranch)}`);
  if (compare.ok) return { ok: true, data: { firstRelease: false, changes: toChanges(compare.data.commits).reverse() } };
  if (compare.error !== "not_found") return compare;
  // No production branch yet: the first launch publishes everything; show the latest changes.
  const latest = await gh<Commit[]>(`/commits?sha=${encodeURIComponent(sourceBranch)}&per_page=20`);
  if (!latest.ok) return latest;
  return { ok: true, data: { firstRelease: true, changes: toChanges(latest.data) } };
}

export type Release = { tag: string; date: string; notes: string; url: string };

export async function listReleases(perPage = 10): Promise<GitHubResult<Release[]>> {
  type Raw = { tag_name: string; published_at: string | null; created_at: string; body: string | null; html_url: string }[];
  const result = await gh<Raw>(`/releases?per_page=${perPage}`);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((r) => ({ tag: r.tag_name, date: r.published_at ?? r.created_at, notes: (r.body ?? "").slice(0, 4000), url: r.html_url })),
  };
}

export type PullRequest = { number: number; state: "open" | "closed"; merged: boolean; draft: boolean; url: string; body: string };

/** The pull request Claude Code opened for one request (branch claude-fix/<id>), if any. */
export async function pullForBranch(branch: string): Promise<GitHubResult<PullRequest | null>> {
  const owner = releaseConfig().repository.split("/")[0];
  type Raw = { number: number; state: "open" | "closed"; merged_at: string | null; draft: boolean; html_url: string; body: string | null }[];
  const result = await gh<Raw>(`/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (!result.ok) return result;
  const pr = result.data[0];
  return {
    ok: true,
    data: pr ? { number: pr.number, state: pr.state, merged: Boolean(pr.merged_at), draft: pr.draft, url: pr.html_url, body: (pr.body ?? "").slice(0, 4000) } : null,
  };
}

export async function mergePull(number: number, title: string): Promise<GitHubResult<null>> {
  const result = await gh<unknown>(`/pulls/${number}/merge`, { method: "PUT", body: { merge_method: "squash", commit_title: title.slice(0, 120) } });
  return result.ok ? { ok: true, data: null } : result;
}

export async function closePull(number: number): Promise<GitHubResult<null>> {
  const result = await gh<unknown>(`/pulls/${number}`, { method: "PATCH", body: { state: "closed" } });
  return result.ok ? { ok: true, data: null } : result;
}
