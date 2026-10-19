/** Reads the first JSON value (array or object) in a model's answer, tolerating code fences and prose. */
export function parseModelJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const open = cleaned[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try {
        return JSON.parse(cleaned.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
