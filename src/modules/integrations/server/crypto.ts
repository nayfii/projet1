import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { integrationsSecret } from "@/lib/env";

/**
 * OAuth tokens are encrypted with AES-256-GCM before they reach the database, with a key derived from
 * INTEGRATIONS_ENCRYPTION_KEY (separate from Hide's key), which never leaves the server.
 */
let key: Buffer | null = null;
let keyFor: string | undefined;

function getKey(): Buffer | null {
  const secret = integrationsSecret();
  if (!secret) return null;
  if (!key || keyFor !== secret) {
    key = Buffer.from(hkdfSync("sha256", secret, "integrations-v1", "tokens", 32));
    keyFor = secret;
  }
  return key;
}

export function integrationsConfigured(): boolean {
  return getKey() !== null;
}

export class IntegrationsUnavailableError extends Error {
  constructor() {
    super("INTEGRATIONS_ENCRYPTION_KEY is not configured");
  }
}

export function sealToken(value: string): string {
  const k = getKey();
  if (!k) throw new IntegrationsUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function openToken(sealed: string): string {
  const k = getKey();
  if (!k) throw new IntegrationsUnavailableError();
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unreadable token");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
