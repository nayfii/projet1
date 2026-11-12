/**
 * Structured server logs: one JSON line per event, read in Vercel's logs (and any log drain plugged into
 * it). They say what happened and how long it took, never what people wrote: fields are short codes,
 * numbers, booleans and ids. Keys that usually carry content or personal data are dropped, long strings
 * are cut. docs/OBSERVABILITY.md lists the events.
 */
export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** Never logged, whatever the caller passes: content, personal data, secrets. */
const FORBIDDEN = /^(content|text|prompt|message|body|input|output|payload|email|name|title|query|value|token|secret|password|authorization|cookie|key)$/i;
const MAX_STRING = 120;

export function logFields(fields: LogFields): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || FORBIDDEN.test(key) || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    else if (typeof value === "number") out[key] = Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
    else out[key] = value;
  }
  return out;
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, ...logFields(fields), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
