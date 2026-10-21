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
        // Tools that ask for a table or a chart get sample ones, so exports and charts can be tested.
        ...(tool && /Markdown table/.test(request.system) ? ["", ...SAMPLE_TABLE] : []),
        ...(/```chart|language is `chart`/.test(request.system) ? ["", ...SAMPLE_CHART] : []),
        // Video agents: a small composition or edit plan the render worker can really make.
        ...(/language is `hyperframes`/.test(request.system) ? ["", ...sampleComposition(text)] : []),
        ...(/language is `editplan`/.test(request.system) ? ["", ...sampleEditPlan(text)] : []),
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

const SAMPLE_TABLE = [
  "| Month | Inflows | Outflows | Balance |",
  "|---|---:|---:|---:|",
  "| [TEST] January | 18 500 | 15 200,50 | 12 300 |",
  "| [TEST] February | 21 000 | 16 800 | 16 500 |",
  "| [TEST] March | 19 400 | 22 100 | 13 800 |",
];

const SAMPLE_CHART = [
  "```chart",
  JSON.stringify({
    type: "line",
    title: "[TEST] Balance",
    unit: "€",
    labels: ["Jan", "Feb", "Mar"],
    series: [
      { name: "Inflows", values: [18500, 21000, 19400] },
      { name: "Outflows", values: [15200.5, 16800, 22100] },
    ],
  }),
  "```",
];

/** A 3-scene HyperFrames composition in the format and duration asked in the form. */
function sampleComposition(text: string): string[] {
  const [w, h] = /9:16/.test(text) ? [1080, 1920] : /1:1/.test(text) ? [1080, 1080] : [1920, 1080];
  const duration = Math.min(30, Number(/(\d+)\s*(?:secondes|seconds)/.exec(text)?.[1] ?? 6));
  const logo = /\[Image attached: "([^"]+)"\]/.exec(text)?.[1];
  const third = Math.round((duration / 3) * 10) / 10;
  return [
    "```hyperframes",
    `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=${w}, height=${h}">`,
    `<meta data-composition-id="motion" data-width="${w}" data-height="${h}" data-duration="${duration}">`,
    `<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${w}px;height:${h}px;overflow:hidden;background:#0f172a;font-family:Inter,sans-serif}`,
    `#stage{position:relative;width:${w}px;height:${h}px}.clip{position:absolute;inset:0;visibility:hidden;display:flex;flex-direction:column;gap:48px;align-items:center;justify-content:center;color:#fff;text-align:center;padding:8%}`,
    `h1{font-size:${Math.round(Math.min(w, h) * 0.1)}px;font-weight:800;opacity:0}p{font-size:${Math.round(Math.min(w, h) * 0.05)}px;opacity:0}img{width:${Math.round(Math.min(w, h) * 0.2)}px;opacity:0}</style></head>`,
    `<body><div id="stage">`,
    `<div id="s1" class="clip" data-start="0" data-duration="${third}" data-track-index="0"><h1>[TEST] Titre</h1></div>`,
    `<div id="s2" class="clip" data-start="${third}" data-duration="${third}" data-track-index="0"><p>[TEST] Message clé</p></div>`,
    `<div id="s3" class="clip" data-start="${2 * third}" data-duration="${Math.round((duration - 2 * third) * 10) / 10}" data-track-index="0">${logo ? `<img src="assets/${logo}" alt="">` : ""}<p>[TEST] Appel à l'action</p></div>`,
    `</div><script>var tl=gsap.timeline({paused:true});`,
    `tl.fromTo("#s1 h1",{opacity:0,y:40},{opacity:1,y:0,duration:0.8},0.1);`,
    `tl.to("#s2 p",{opacity:1,duration:0.6},${third + 0.1});`,
    `tl.to("#s3 p, #s3 img",{opacity:1,duration:0.6},${2 * third + 0.1});`,
    `tl.set({},{},${duration});window.__timelines=window.__timelines||{};window.__timelines["motion"]=tl;</script></body></html>`,
    "```",
  ];
}

/** An edit plan over the attached clips (3 seconds of each), in the formats asked in the form. */
function sampleEditPlan(text: string): string[] {
  const clips = [...text.matchAll(/\[Video "([^"]+)"(?:: ([\d.]+) s)?/g)].map((m) => ({ name: m[1], duration: m[2] ? Number(m[2]) : 3 }));
  const formats = /16:9 · |landscape/.test(text) && !/Les trois|All three/.test(text) ? ["16:9"] : /9:16 · /.test(text) && !/Les trois|All three/.test(text) ? ["9:16"] : /1:1 · /.test(text) && !/Les trois|All three/.test(text) ? ["1:1"] : ["16:9", "9:16", "1:1"];
  const segments = clips.map((c) => ({ clip: c.name, start: 0, end: Math.min(3, c.duration) }));
  return ["```editplan", JSON.stringify({ title: "[TEST] Montage", segments, captions: [{ text: "[TEST] Sous-titre", start: 0.2, end: 2 }], formats, fit: "crop" }), "```"];
}

async function* simulated(answer: string): AsyncIterable<ChatEvent> {
  yield { type: "text", delta: answer };
  yield { type: "usage", usage: { inputTokens: 100, outputTokens: estimateTokens(answer), cachedInputTokens: 0 } };
  yield { type: "done", finishReason: "stop" };
}
