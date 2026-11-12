/**
 * The integrations catalogue (CLAUDE.md §12): one definition per provider, used by the catalogue screen,
 * the OAuth flow, the actions and the workflows. No secret here: client ids and secrets are read on our
 * server from the environment (see `.env.example`).
 *
 * Permissions are asked per app (least privilege): connecting Google Calendar alone never asks for Gmail.
 * Every capability listed is implemented against the provider's official API (server/executors.ts);
 * what an API does not allow is stated as a limitation, never simulated.
 */

export const PROVIDER_IDS = ["google", "microsoft", "slack", "notion", "canva", "hubspot"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type CapabilityUse = "chat" | "memory" | "workflow";

export type Capability = {
  id: string;
  app: string;
  kind: "read" | "write";
  /** Where Cendr uses it. */
  uses: CapabilityUse[];
};

export type IntegrationApp = { id: string; scopes: string[] };

export type OAuthConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  pkce: boolean;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "body" | "basic";
  tokenBody: "form" | "json";
  scopeSeparator: " " | ",";
  /** The authorize parameter the scopes go in (Slack's bot scopes: "scope"). */
  scopeParam: "scope" | "user_scope" | null;
  extraParams?: Record<string, string>;
};

export type ProviderDef = {
  id: ProviderId;
  name: string;
  status: "available" | "soon";
  /** Environment variables holding the OAuth client (set by our team in Vercel). */
  env: { clientId: string; clientSecret: string };
  oauth: OAuthConfig | null;
  baseScopes: string[];
  apps: IntegrationApp[];
  capabilities: Capability[];
};

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  google: {
    id: "google",
    name: "Google Workspace",
    status: "available",
    env: { clientId: "GOOGLE_OAUTH_CLIENT_ID", clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET" },
    oauth: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      pkce: true,
      clientAuth: "body",
      tokenBody: "form",
      scopeSeparator: " ",
      scopeParam: "scope",
      // A refresh token, and the consent screen each time (so a reconnection gets a new refresh token).
      extraParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    },
    baseScopes: ["openid", "email", "profile"],
    apps: [
      { id: "gmail", scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"] },
      { id: "calendar", scopes: ["https://www.googleapis.com/auth/calendar.events"] },
      // Docs and Sheets are read through Drive (export as text / CSV).
      { id: "drive", scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
    ],
    capabilities: [
      { id: "gmail.search", app: "gmail", kind: "read", uses: ["chat", "workflow"] },
      { id: "gmail.draft", app: "gmail", kind: "write", uses: ["workflow"] },
      { id: "gmail.send", app: "gmail", kind: "write", uses: ["workflow"] },
      { id: "calendar.events", app: "calendar", kind: "read", uses: ["chat", "workflow"] },
      { id: "calendar.create_event", app: "calendar", kind: "write", uses: ["workflow"] },
      { id: "drive.search", app: "drive", kind: "read", uses: ["chat", "memory", "workflow"] },
      { id: "drive.read", app: "drive", kind: "read", uses: ["chat", "memory", "workflow"] },
    ],
  },
  microsoft: {
    id: "microsoft",
    name: "Microsoft 365",
    status: "available",
    env: { clientId: "MICROSOFT_OAUTH_CLIENT_ID", clientSecret: "MICROSOFT_OAUTH_CLIENT_SECRET" },
    oauth: {
      authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      pkce: true,
      clientAuth: "body",
      tokenBody: "form",
      scopeSeparator: " ",
      scopeParam: "scope",
      extraParams: { response_mode: "query", prompt: "select_account" },
    },
    baseScopes: ["openid", "email", "profile", "offline_access", "User.Read"],
    apps: [
      { id: "outlook", scopes: ["Mail.ReadWrite", "Mail.Send"] },
      { id: "outlook_calendar", scopes: ["Calendars.ReadWrite"] },
      // OneDrive and the SharePoint files the person can open; Word, Excel and PowerPoint files are files there.
      { id: "onedrive", scopes: ["Files.Read.All"] },
      { id: "teams", scopes: ["Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send"] },
    ],
    capabilities: [
      { id: "outlook.search", app: "outlook", kind: "read", uses: ["chat", "workflow"] },
      { id: "outlook.draft", app: "outlook", kind: "write", uses: ["workflow"] },
      { id: "outlook.send", app: "outlook", kind: "write", uses: ["workflow"] },
      { id: "outlook_calendar.events", app: "outlook_calendar", kind: "read", uses: ["chat", "workflow"] },
      { id: "outlook_calendar.create_event", app: "outlook_calendar", kind: "write", uses: ["workflow"] },
      { id: "onedrive.search", app: "onedrive", kind: "read", uses: ["chat", "memory", "workflow"] },
      { id: "onedrive.read", app: "onedrive", kind: "read", uses: ["chat", "memory", "workflow"] },
      { id: "teams.channels", app: "teams", kind: "read", uses: ["workflow"] },
      { id: "teams.post", app: "teams", kind: "write", uses: ["workflow"] },
    ],
  },
  slack: {
    id: "slack",
    name: "Slack",
    status: "available",
    env: { clientId: "SLACK_OAUTH_CLIENT_ID", clientSecret: "SLACK_OAUTH_CLIENT_SECRET" },
    oauth: {
      authorizeUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      revokeUrl: "https://slack.com/api/auth.revoke",
      pkce: false,
      clientAuth: "body",
      tokenBody: "form",
      scopeSeparator: ",",
      scopeParam: "scope",
    },
    baseScopes: [],
    apps: [{ id: "slack", scopes: ["channels:read", "channels:history", "chat:write"] }],
    capabilities: [
      { id: "slack.channels", app: "slack", kind: "read", uses: ["workflow"] },
      { id: "slack.read", app: "slack", kind: "read", uses: ["chat", "workflow"] },
      { id: "slack.post", app: "slack", kind: "write", uses: ["workflow"] },
    ],
  },
  notion: {
    id: "notion",
    name: "Notion",
    status: "available",
    env: { clientId: "NOTION_OAUTH_CLIENT_ID", clientSecret: "NOTION_OAUTH_CLIENT_SECRET" },
    oauth: {
      authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
      tokenUrl: "https://api.notion.com/v1/oauth/token",
      revokeUrl: "https://api.notion.com/v1/oauth/revoke",
      pkce: false,
      clientAuth: "basic",
      tokenBody: "json",
      scopeSeparator: " ",
      // Notion has no scopes: the person picks the pages the integration may reach.
      scopeParam: null,
      extraParams: { owner: "user" },
    },
    baseScopes: [],
    apps: [{ id: "notion", scopes: [] }],
    capabilities: [
      { id: "notion.search", app: "notion", kind: "read", uses: ["chat", "memory", "workflow"] },
      { id: "notion.read", app: "notion", kind: "read", uses: ["chat", "memory", "workflow"] },
      { id: "notion.create_page", app: "notion", kind: "write", uses: ["workflow"] },
    ],
  },
  canva: {
    id: "canva",
    name: "Canva",
    status: "available",
    env: { clientId: "CANVA_OAUTH_CLIENT_ID", clientSecret: "CANVA_OAUTH_CLIENT_SECRET" },
    oauth: {
      authorizeUrl: "https://www.canva.com/api/oauth/authorize",
      tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
      revokeUrl: "https://api.canva.com/rest/v1/oauth/revoke",
      pkce: true,
      clientAuth: "basic",
      tokenBody: "form",
      scopeSeparator: " ",
      scopeParam: "scope",
    },
    baseScopes: ["profile:read"],
    apps: [{ id: "canva", scopes: ["design:meta:read", "design:content:read", "design:content:write"] }],
    capabilities: [
      { id: "canva.designs", app: "canva", kind: "read", uses: ["workflow"] },
      { id: "canva.create", app: "canva", kind: "write", uses: ["workflow"] },
      { id: "canva.export", app: "canva", kind: "read", uses: ["workflow"] },
    ],
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    status: "soon",
    env: { clientId: "HUBSPOT_OAUTH_CLIENT_ID", clientSecret: "HUBSPOT_OAUTH_CLIENT_SECRET" },
    oauth: null,
    baseScopes: [],
    apps: [{ id: "hubspot", scopes: [] }],
    capabilities: [],
  },
};

export const PROVIDER_LIST: ProviderDef[] = PROVIDER_IDS.map((id) => PROVIDERS[id]);

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** The permissions asked for the chosen apps (always the base ones, then each app's), without repeats. */
export function scopesFor(provider: ProviderDef, apps: string[]): string[] {
  const chosen = provider.apps.filter((a) => apps.includes(a.id));
  return [...new Set([...provider.baseScopes, ...chosen.flatMap((a) => a.scopes)])];
}

export function capability(provider: ProviderDef, id: string): Capability | undefined {
  return provider.capabilities.find((c) => c.id === id);
}
