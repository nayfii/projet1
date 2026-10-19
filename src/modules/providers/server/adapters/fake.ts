import "server-only";
import type { ChatEvent, ChatProvider, ChatRequest, ProviderErrorCode, ProviderId } from "../../types";
import { estimateTokens } from "../../tokens";

/**
 * SIMULATED provider for automated tests (AI_FAKE_PROVIDER=true). It never calls a real API.
 * Its answers start with "[TEST]" so a simulated answer can never be mistaken for a real one.
 * Writing "[[fail:<code>]]" in a message simulates that provider error (e.g. [[fail:rate_limited]]);
 * "[[fail:<code>@<provider>]]" fails only with that provider (e.g. [[fail:unavailable@google]]).
 * "[[slow]]" writes the answer slowly (about 3 seconds), to test what happens mid-answer.
 */
export function createFakeProvider(id: ProviderId): ChatProvider {
  return {
    id,
    isConfigured: () => true,
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
      const last = request.messages.at(-1);
      const text = last?.content.map((p) => (p.type === "text" ? p.text : "[image]")).join(" ") ?? "";
      const match = /\[\[fail:([a-z_]+)(?:@([a-z]+))?\]\]/.exec(text);
      const failure = match && (!match[2] || match[2] === id) ? match[1] : null;
      if (failure) {
        yield { type: "error", error: { code: failure as ProviderErrorCode, retryable: failure === "rate_limited" } };
        return;
      }
      // Memory tasks expect JSON.
      if (request.system.startsWith("Task: extract memory entries.")) {
        yield* simulated(JSON.stringify([{ title: "[TEST] Point clé", content: `[TEST] ${text.slice(0, 160)}` }]));
        return;
      }
      if (request.system.startsWith("Task: write a handover file.")) {
        yield* simulated(
          JSON.stringify({
            summary: "[TEST] Résumé du travail réalisé.",
            decisions: "- [TEST] Décision prise pendant la conversation.",
            documents: "- [TEST] Documents utiles.",
            tasks: "- [TEST] Tâche restante.",
            next_actions: "- [TEST] Prochaine action.",
          }),
        );
        return;
      }
      if (request.system.startsWith("Task: turn a conversation into a reusable tool.")) {
        yield* simulated(
          JSON.stringify({
            name: "[TEST] Synthèse client",
            description: "[TEST] Résume une situation client en trois points.",
            department: "sales",
            input_fields: [
              { label: "Client", type: "client", required: true },
              { label: "Notes de réunion", type: "textarea", required: true },
            ],
            instructions: "[TEST] Résume les notes de réunion pour le client choisi, en trois points, puis propose une prochaine étape.",
            output_format: "document",
            memory_scope: "company_and_client",
          }),
        );
        return;
      }
      if (request.system.startsWith("Task: critique answers.")) {
        const reviewed = [...text.matchAll(/^Answer from (.+?):$/gm)].map((m) => m[1]);
        yield* simulated(`[TEST] Critique of ${reviewed.join(" and ")}: one claim needs checking; the reasoning is otherwise sound.`);
        return;
      }
      if (request.system.startsWith("Task: synthesise a confrontation.")) {
        const answered = [...text.matchAll(/^Answer from (.+?):$/gm)].map((m) => m[1]);
        const question = /^Question:\n([\s\S]*?)\n\n---/m.exec(text)?.[1] ?? "";
        yield* simulated(
          JSON.stringify({
            agreements: [`[TEST] ${answered.join(", ")} agree on the main point.`],
            divergences: ["[TEST] They differ on the level of detail."],
            errors: ["[TEST] One answer gives a figure without a source."],
            to_verify: ["[TEST] Check the figures before using them."],
            recommended: `[TEST] Recommended answer combining ${answered.length} answers to: «${question.slice(0, 200)}»`,
          }),
        );
        return;
      }
      if (request.system.startsWith("Task: generalise a client note.")) {
        yield* simulated(JSON.stringify({ general: true, title: "[TEST] Enseignement général", content: "[TEST] Les clients de ce secteur préfèrent des points courts et réguliers." }));
        return;
      }
      const userTurns = request.messages.filter((m) => m.role === "user").length;
      // Memory passages are numbered "[S1] …" in the system prompt: cite the first one, like a real model would.
      const passages = [...request.system.matchAll(/^\[S(\d+)\] /gm)].length;
      const images = request.messages.flatMap((m) => m.content).filter((p) => p.type === "image").length;
      // Who Can Help: suggest a listed colleague whose declared expertise appears in the question.
      const colleagues = request.system.split("## Colleagues who can help")[1] ?? "";
      const helper = [...colleagues.matchAll(/^- (.+?): (.+)$/gm)].find((m) =>
        m[2].split(",").some((skill) => skill.trim().length >= 4 && text.toLowerCase().includes(skill.trim().toLowerCase())),
      );
      // A tool's instructions are in the system prompt: say which tool, like a real model would follow it.
      const tool = /^## Tool: (.+)$/m.exec(request.system)?.[1];
      const answer = [
        `[TEST] Simulated answer from **${request.apiModelId}**.`,
        "",
        `- Messages received: ${request.messages.length} (${userTurns} from people)`,
        `- Images received: ${images}`,
        `- Your last message had ${text.length} characters.`,
        // Shows exactly what the model received (with Hide, placeholders instead of sensitive values).
        `- Last message as received: «${text.slice(0, 300)}»`,
        ...(tool ? [`- Tool instructions received: ${tool}`] : []),
        ...(passages > 0 ? [`- Knowledge passages received: ${passages}`, "", "Based on the company memory [S1]."] : []),
        ...(helper ? ["", `You can ask ${helper[1]} about it.`] : []),
      ].join("\n");
      for (const word of answer.split(/(?<=\s)/)) {
        if (signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, text.includes("[[slow]]") ? 80 : 8));
        yield { type: "text", delta: word };
      }
      const input = estimateTokens(request.system) + request.messages.reduce((sum, m) => sum + estimateTokens(m.content.map((p) => (p.type === "text" ? p.text : "")).join("")), 0);
      yield { type: "usage", usage: { inputTokens: input, outputTokens: estimateTokens(answer), cachedInputTokens: 0 } };
      yield { type: "done", finishReason: "stop" };
    },
  };
}

async function* simulated(answer: string): AsyncIterable<ChatEvent> {
  yield { type: "text", delta: answer };
  yield { type: "usage", usage: { inputTokens: 100, outputTokens: estimateTokens(answer), cachedInputTokens: 0 } };
  yield { type: "done", finishReason: "stop" };
}
