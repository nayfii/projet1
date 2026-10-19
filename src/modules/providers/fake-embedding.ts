/**
 * SIMULATED embedding for automated tests (AI_FAKE_PROVIDER=true): words are hashed into the vector,
 * so texts sharing words are "similar". Never used with real providers.
 */
export function fakeEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  for (const word of words) {
    let hash = 2166136261;
    for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 16777619);
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}
