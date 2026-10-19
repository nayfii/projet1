import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { hideSecret } from "@/lib/env";

/**
 * Real values behind placeholders are encrypted with AES-256-GCM before they reach the database,
 * and identified by an HMAC so the same value keeps the same placeholder. Both keys are derived from
 * HIDE_ENCRYPTION_KEY, which never leaves the server.
 */

let keys: { enc: Buffer; mac: Buffer } | null = null;
let keysFor: string | undefined;

function getKeys() {
  const secret = hideSecret();
  if (!secret) return null;
  if (!keys || keysFor !== secret) {
    keys = {
      enc: Buffer.from(hkdfSync("sha256", secret, "hide-v1", "encryption", 32)),
      mac: Buffer.from(hkdfSync("sha256", secret, "hide-v1", "hmac", 32)),
    };
    keysFor = secret;
  }
  return keys;
}

export class HideUnavailableError extends Error {
  constructor() {
    super("HIDE_ENCRYPTION_KEY is not configured");
  }
}

export function hideConfigured(): boolean {
  return getKeys() !== null;
}

export function valueHash(conversationId: string, category: string, canonical: string): string {
  const k = getKeys();
  if (!k) throw new HideUnavailableError();
  return createHmac("sha256", k.mac).update(`${conversationId}\n${category}\n${canonical}`).digest("base64url");
}

export function encryptValue(value: string): string {
  const k = getKeys();
  if (!k) throw new HideUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k.enc, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptValue(payload: string): string {
  const k = getKeys();
  if (!k) throw new HideUnavailableError();
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("unknown hide ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", k.enc, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
