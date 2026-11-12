# Integrations (V1.1)

One central layer (`src/modules/integrations`) connects the business apps a company uses. A connection
serves, within the person's and the company's rights: **the chat and Consciousness** (read documents
into a memory: "Depuis une application" in a memory's Documents tab) and **workflows** (lot 5).

This is not the connection of a person's AI subscription: new AI requests still go through Cendr's
own API accounts.

## How it works

| Piece | Where | What |
|---|---|---|
| Catalogue | `providers.ts` | One definition per provider: apps, permissions per app (least privilege), capabilities (read / write, used by chat, Conscience or workflows) |
| OAuth 2.0 | `server/oauth.ts`, `/api/integrations/[provider]/connect` and `/callback` | Authorization code with **PKCE (S256)** where the provider supports it (Google, Microsoft, Canva); a one-time `state` kept on our server for 10 minutes and bound to the person and company; the code is exchanged on our server; no secret ever reaches the browser |
| Tokens | `integration_tokens` (service role only) | Sealed with AES-256-GCM, key derived from `INTEGRATIONS_ENCRYPTION_KEY` (separate from Hide's key). Refreshed before expiry; a refused refresh marks the connection "À reconnecter" |
| Rights | `server/access.ts`, RLS on `integration_connections` | Personal connection: used by its owner only. Company connection: made by the Owner or an Admin with the **"models"** scope (AI and tools settings), used by members. Owner / those Admins see every connection's metadata, can switch a provider off for the company and revoke any connection; they never use a personal one. Our team sees nothing |
| Actions | `server/executors.ts` | Official REST APIs only (no SDK), inputs validated, provider errors turned into codes (never the provider's message, which may quote content) |
| Audit | `audit_log` | Connected, revoked, settings changed, each **write** action used or failed: provider, capability, ids — never the content |

## Per connector

Status of tests for all connectors: **unit tests** of every request's shape against the providers'
documented APIs (`tests/unit/integrations.test.ts`), **integration tests** of the whole flow with
Google simulated at the network level (`tests/integration/integrations.test.ts`: consent address,
PKCE, state replay or theft refused, sealed tokens, rights, refresh refused → reconnect, provider
switched off, revocation, audit without content). **Not yet tested against the real providers**: our
team must first register Cendr with each one (below).

| Connector | Capabilities | Permissions asked | Provider prerequisites (our team) | Limitations |
|---|---|---|---|---|
| **Google Workspace** (Gmail, Calendar, Drive incl. Docs and Sheets) | Gmail: search, draft, send. Calendar: upcoming events, create event. Drive: search, read (Docs as text, Sheets as CSV, PDF / Word / Excel read on our server) | `openid email profile` + per app: `gmail.readonly` `gmail.compose` / `calendar.events` / `drive.readonly` | OAuth client (Web) in Google Cloud, redirect `…/api/integrations/google/callback`; **Gmail and Drive are restricted scopes: Google's app verification and a security assessment are required before opening to all users** (until then, test users only) | Docs / Sheets are not edited; formatting is lost when read; Slides are read as text |
| **Microsoft 365** (Outlook, calendar, OneDrive / SharePoint, Word / Excel / PowerPoint files, Teams) | Outlook: search, draft, send. Calendar: events, create. OneDrive/SharePoint: search, read (Word, Excel, PDF, text). Teams: list channels, post | `openid email profile offline_access User.Read` + per app: `Mail.ReadWrite Mail.Send` / `Calendars.ReadWrite` / `Files.Read.All` / `Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Send` | App registration in Microsoft Entra (multi-tenant), redirect URI, client secret. Teams permissions usually need a tenant administrator's consent | PowerPoint files are not read as text. **No per-app token revocation at Microsoft**: Cendr deletes its tokens; the person removes Cendr from their account (myapps.microsoft.com) |
| **Slack** | List public channels, read a channel's history, post a message | Bot scopes `channels:read channels:history chat:write` | Slack app with OAuth redirect URL; distribution enabled for other workspaces | Only public channels where the Cendr app was added; no private messages or DMs |
| **Notion** | Search pages, read a page (blocks as text), create a page under a page | None (Notion has no scopes: the person picks pages at consent) | Public integration in Notion, redirect URI | Only pages shared with the integration; nested databases are not read |
| **Canva** | List designs, create a **blank** design (doc, presentation, whiteboard), export a design (PDF, PNG; asynchronous job) | `profile:read design:meta:read design:content:read design:content:write` | Canva Connect integration (PKCE), redirect URL, review by Canva for public use | **The API cannot write content into a design** (except brand-template autofill, Canva Enterprise only): Cendr says so in the catalogue and never pretends to fill a design |
| **HubSpot** | — (shown "Bientôt") | — | — | Planned after V1.1; the layer takes a new provider as one definition plus its executors |

## Adding a provider

1. Add its definition to `providers.ts` (apps, scopes, capabilities, OAuth endpoints).
2. Add its account lookup to `server/oauth.ts` and its capabilities to `server/executors.ts`.
3. Add its texts (`integrations.provider.*`, `capability.*`, `access.*`) in French and English.
4. Add unit tests for its requests; document it here.

## Environment (set by our team, never in code)

`INTEGRATIONS_ENCRYPTION_KEY` (32+ characters) and, per provider, `<PROVIDER>_OAUTH_CLIENT_ID` /
`<PROVIDER>_OAUTH_CLIENT_SECRET` (see `.env.example`). Without them the catalogue says "En attente de
configuration par l'équipe Cendr" and nothing can be connected; nothing is simulated.
