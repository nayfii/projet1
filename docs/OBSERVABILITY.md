# Observability (V1.1, phase 10)

What we can see of the platform in operation, without ever seeing what customers wrote.

## What exists

| Need | How | Where |
|---|---|---|
| Structured logs | One JSON line per event (`src/lib/log.ts`): level, event, short codes, numbers, ids, time. Keys that usually carry content or personal data (`content`, `text`, `prompt`, `message`, `email`, `name`, `token`…) are dropped whatever the caller passes; strings are cut at 120 characters (unit test `tests/unit/log.test.ts`) | Vercel → project → **Logs** (and any log drain added there) |
| Liveness | `GET /api/health`: 200 `{status:"ok", version, checks:{database:{ok, ms}}}` when the site and the database answer within 3 s, otherwise 503. Public, no data | Any uptime service; `.github/workflows/uptime.yml` |
| Alerts | `.github/workflows/uptime.yml` checks `/api/health` every 10 minutes (3 tries). A failed run is an alert: GitHub e-mails it to whoever watches the repository's Actions. Needs the repository variable `APP_URL` | GitHub → Actions |
| Workflow runs | Each finished run logs `workflow.run_finished` (run, workflow, status, mode, trigger, error code, duration). Each clock run logs `cron.tick` (counts, duration) and is recorded in `platform_heartbeats` | Logs; our console → **Santé → Opérations** |
| Workflows' clock | Last run, schedules started, runs executed. "En retard" after 15 minutes, "Jamais lancée" when it never ran (then `CRON_SECRET` / `APP_URL` are missing) | Our console → Santé → Opérations |
| Execution queue | Active workflows, waiting runs, failures over 24 h, most frequent error code, stuck runs (executor vanished; they are resumed at the clock's next run), oldest waiting run | Same |
| Knowledge imports | In progress, started and finished over 24 h, stopped for more than an hour | Same |
| Connected apps | Per service: active connections, to reconnect (expired or refused), revoked. Each call to an app logs `integration.call` (service, capability, read/write, outcome, duration) | Same, and Logs |
| Latencies | Per feature (chat, dictation, memory, workflow…): requests, errors, median and 95th percentile over 24 h, from `usage_events.latency_ms` | Same |
| AI providers | Per provider: requests, error rate, average latency, last success, live test (existed before V1.1) | Our console → Santé |
| Dictation | `Server-Timing` (checks, model, total) on each part; `cendr:dictation:*` timing marks in the browser (docs/DICTATION.md) | Browser developer tools |
| Deployments | Versions page (v1.0, v1.1…), the version check with demo accounts, Vercel's deployment history | Our console → Versions / Aperçu; Vercel |
| Audit | Sign-ins, permission changes, transfers, masking events (metadata), blocked requests, integration writes; our team's actions | Company → Journal d'activité; our console → Journal |

Our team's indicators come from `platform_operations_health` (a database function for platform admins
only, tested: `tests/integration/operations.test.ts`). It returns counts, codes and times. It never
returns a workflow's name or data, a document, a message or a person's name. Company Owners and members
cannot call it. Nobody signed in can read `platform_heartbeats`; only our server writes it.

## Events logged

| Event | Level | Fields |
|---|---|---|
| `cron.tick` | info | scheduled, emails, executed, ms |
| `cron.refused` | warn | configured |
| `cron.heartbeat_failed` | error | — |
| `workflow.run_finished` | info / warn (failed) | run, workflow, status, mode, trigger, code, ms |
| `webhook.refused` | warn | workflow, code |
| `integration.call` | info / warn | provider, capability, kind, outcome, ms |
| `health.database_down` | error | ms |

These come in addition to the older error lines (database insert failures with their codes, sign-in
failures with their codes). None of them contains a prompt, an answer, a document or a masked value.

## Not in place (and why)

- **An error-tracking service** (Sentry or similar): it needs an account, a data-processing agreement and
  an EU region. That is the founder's decision (CLAUDE.md §9: paid services). Until then: Vercel logs and
  the uptime alert.
- **Log retention and search**: Vercel keeps logs for a limited time that depends on the plan. Longer
  retention needs a log drain to an EU service, also a decision.
- **Paging**: alerts go by e-mail (GitHub). There is no phone paging.
- **Real-user performance**: page speed is measured in tests (`e2e/perf.spec.ts`, docs/STATUS.md), not
  collected from real visitors.
