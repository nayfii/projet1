# Roadmap

Where the product stands after the ten build steps (2026-10-25), and what comes next.
Details per feature: [`STATUS.md`](STATUS.md). Security: [`SECURITY.md`](SECURITY.md). Putting it online: [`DEPLOY.md`](DEPLOY.md).

## Ready

Built, tested automatically (unit, isolation and end-to-end tests), and checked together in the launch scenario of CLAUDE.md §10 (`e2e/launch.spec.ts`, simulated AI):

- Accounts by email link, companies, roles (Owner, Admin with delegated scopes, Member), invitations, onboarding.
- Multi-model chat (ChatGPT, Claude, Gemini): streaming, history, search, model switch mid-conversation, Auto mode with its reason, files, copy, regenerate, clarifying questions.
- Company memory and per-client memories, open or restricted clients, permission groups, documents read on our servers, search by meaning, Source Proof down to the passage, AI suggestions approved by a person, promotion to company memory.
- Hide: automatic, documents and manual protection, placeholders restored for people who may see them, admin settings and sensitive terms.
- Collaboration: group conversations with mentions, shared history from a chosen message, the AI limited to what everyone can see, transfers with Smart Handover, Who Can Help.
- Confronter, Turn into a tool, the library and the 16 launch agents (with exports, charts, notices), video agents with a render worker.
- Admin consoles: the company's (people, rights, models, agents, Hide, usage, quotas, activity) and our team's (companies, plans and prices, credits, margins, provider health, log) without access to customer content.
- A test deployment in the EU (Supabase Frankfurt, Vercel Frankfurt), the database installed by GitHub.

## Partial

- **Real AI**: tested against OpenAI earlier; Claude and Gemini adapters are built but not yet checked against their real APIs (keys and credit needed). The test site runs with simulated AI.
- **Emails**: Supabase's test mailer (2 per hour, team members only, its default English templates). Our own sender (Resend or similar, with a domain) makes invitations and our templates work for everyone.
- **Videos online**: the worker image builds on GitHub, but it is not hosted yet, so videos stay "waiting" online.
- **Search by meaning**: needs a working embeddings key (OpenAI with credit, or Gemini); otherwise documents are found by their words.
- **Security**: reviewed and fixed (SECURITY.md §5); a few hardening items remain (nonce-based CSP, deploy environment protection, rate limits), and an external audit has not been done.
- **Seats, plans and prices**: configurable by our team, assigned by hand; no online payment.

## Before a first paying customer

1. Decide the product framing (journeys, plans, options): see below.
2. Real AI keys and accounts with billing (OpenAI, Anthropic, Google), with the providers' EU or data-retention options reviewed; then the real-model tests (`pnpm test:smoke`).
3. Production hosting on paid plans (Vercel Pro or another EU host, Supabase Pro with backups), our own email sender and domain, monitoring and error alerts, a status page.
4. Host the render worker (EU container service) — or launch without the video agents.
5. Legal: terms of service, privacy policy and data processing agreement (we process customer data and send part of it to AI providers), the GSAP licence for Motion Design, the legal review of the Application Review Assistant (EU AI Act).
6. Close the open security items (SECURITY.md risks 22–25) and run an external audit (SECURITY.md §6).
7. Support: how a customer reaches us, how we restore data, how an account is closed and its data deleted.

## Next (after launch)

- Online payment (Stripe), self-serve plans, usage-based extra credits.
- **Our back-office (founder's request, second round):** customer support for our customers' platforms (access to their content only with their explicit, time-limited, logged consent) and growth tools (account follow-up, activation, usage trends, retention).
- Ownership transfer between Owners, a company switcher for people in several companies, Google sign-in.
- Data export of a company's memory; deletion requests across Source Proof copies.
- Meeting minutes from audio (speech to text), OCR for scanned documents.
- Backlog of CLAUDE.md §6 (integrations, more providers, EU-hosted models, SSO…) only when asked.

## Product framing (to do with the founder)

The founder asked to redefine the journeys and the logic of the platform: which options are offered, to whom, and in what order. Input for that discussion:

- the journeys that exist today (onboarding, first conversation, memory, clients, agents, collaboration, admin);
- what each plan includes (seats, credits, video credits, which agents and models);
- what is visible by default to a Member, an Admin and the Owner, and what stays behind settings.
