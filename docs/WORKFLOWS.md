# Workflows (V1.1)

Automations made of steps — a trigger, AI steps, connected apps, logic and actions — built on a canvas
or with the Cendr AI copilot (`src/modules/workflows`, pages `/workflows` and `/workflows/[id]`).

## Model

| Piece | Where | What |
|---|---|---|
| Node catalogue | `nodes.ts` | 37 node types in 5 families (trigger, AI, connected apps, logic, actions) with their settings, exits, the app capability they need and what they may do when on (`sensitivity`). Types not built yet are shown "Bientôt" and cannot be added |
| Graph | `graph.ts` | Validation (one trigger, every step reached, no cycle, real exits, required settings, usable connections), variables `{{trigger.x}}`, `{{steps.<id>.x}}`, `{{vars.x}}`, `{{loop.item}}`, comparisons, the next time of a schedule (Europe/Paris, summer time included) |
| Draft / versions | `workflows.draft` (+ `draft_revision`), `workflow_versions` | The editor autosaves the draft (a stale revision is refused: no silent overwrite). **Play** freezes the draft into a new immutable version; runs always use the version they started with. Editing never changes the active version |
| Engine | `server/engine.ts` | Runs are rows in a queue (`workflow_runs`); one executor at a time holds a run (lease, 5 min); each step is recorded **before** it acts (`workflow_run_steps`); a run that resumes never repeats a step already done, and an **action found "running" from an interrupted attempt fails as "interrupted" instead of being repeated** (an e-mail is never sent twice). Reads and AI steps are retried twice on provider errors; actions are not. 60 s per step, 400 steps per run, 50 loop items, 24 h delays (the run waits in the queue, not in memory), 3 levels of "start another workflow", a run that runs out of time goes back to the queue and resumes |
| Rights | `server/runtime.ts` | A workflow **runs with its author's rights**, also when nobody is signed in: at each run our server checks that the author is still an active member of an active company (otherwise the run fails and the workflow is paused), their credits (`workflow_quota_status`), the memories they may read or write (`workflow_member_spaces`, the same SQL rule as everywhere) and the connections they may use (`runCapability`). AI steps go through Hide (placeholders to the model, real values back) and count as usage "workflow" |
| Triggers | `server/engine.ts` (`tick`), `/api/cron/workflows`, `/api/workflows/hooks/[id]` | Manual; scheduled (hourly, daily, weekdays, weekly); new e-mail (Gmail / Outlook, polled every 5 min, each message once, the first look only notes what is there); authenticated webhook (`Authorization: Bearer <secret>`, secret stored as SHA-256 and shown once, `Idempotency-Key`, 60 calls per hour). Document, Slack-message and calendar triggers: "Bientôt" |
| Play / Pause | `server/actions.ts` | Play validates on our server (with the author's connections); when the workflow may write outside (send e-mails or invitations, post, create or change data), the person confirms once, knowing what. Pause stops new automatic runs and cancels the queued and waiting ones; what was already done stays done |
| Test mode | `runWorkflowAction(mode: "test")` | Runs the **draft** with test data: reads and AI for real (credits), **actions only shown** ("Simulé (non envoyé)" with what would have been sent), delays skipped, each step's input/output and duration visible |
| Copilot | `server/copilot.ts`, `ops.ts` | The model sees a compact view (types, links, short settings; no secret, no run data), the node types, the person's connections, memories and workflows (ids and names). It answers with structured changes (`add_node`, `update_node`, `remove_node`, `connect`, `disconnect`), checked and applied to a copy on our server; the editor applies them with undo, and **asks first when a change touches an action that writes outside** |
| Templates | `templates.ts` | 10 real graphs (e-mail digest, weekly update, meeting minutes, document analysis, prospecting, lead triage, priority alert, week preparation, content, client file). The person chooses connections, recipients and memories; Play says what is missing |
| Editor | `ui/editor.tsx` | React Flow (MIT): drag and drop from the library, links, zoom, pan, fit, multi-selection, snap, auto-arrange, duplicate (Ctrl+D), delete, undo / redo (Ctrl+Z / Ctrl+Shift+Z), problems shown on the steps, settings with variables to insert, collapsible panels, minimap for large graphs |

## Rights and isolation (RLS)

A personal workflow is its author's: colleagues do not see it; the Owner and Admins with the "models"
scope see that it exists (governance) but **not its runs**. A company workflow is seen by members and
edited by its author and those governors; it still runs with its author's rights. Status, versions,
runs and steps are written only by our server. Tests: `tests/integration/workflows.test.ts`.

## The clock

`/api/cron/workflows` is protected by `CRON_SECRET`. Vercel's Hobby plan allows one cron a day:
`vercel.json` keeps a daily safety net, and `.github/workflows/workflows-tick.yml` calls it every
5 minutes (needs the `CRON_SECRET` secret and the `APP_URL` variable in GitHub; scheduled GitHub
workflows run from the default branch and may be delayed). On Vercel Pro, a `*/5 * * * *` cron in
`vercel.json` replaces the GitHub workflow.

## Limits (V1.1)

- Triggers on new documents, Slack messages and calendar events, and CRM actions: "Bientôt".
- E-mail triggers poll (every 5 minutes at best), they do not receive push notifications.
- Steps run one after the other (no parallel branches); loops run their "Chaque" branch item by item.
- The copilot works on the draft open in the editor; it does not read run data.
