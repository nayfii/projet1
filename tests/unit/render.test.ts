import { describe, expect, it } from "vitest";
import { compositionCsp, extractComposition, fontCss, inspectComposition, prepareComposition } from "@/modules/render/composition";
import { editPlanSchema, extractEditPlan, ffmpegArgs, fitPlanToClips, planDuration, wrapCaption, type EditPlan } from "@/modules/render/edit-plan";
import { formatOfSize, renderCredits, videoContentMatches, videoExtensionOf } from "@/modules/render/formats";
import { buildChatContext } from "@/modules/conversations/context";

const composition = (meta = 'data-width="1080" data-height="1920" data-duration="10"', timeline = 'window.__timelines["motion"] = tl;') => `<!doctype html><html><head>
<meta data-composition-id="motion" ${meta}>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<meta http-equiv="refresh" content="0; url=https://example.com">
<base href="https://example.com/">
</head><body><div class="clip" data-start="0" data-duration="10" data-track-index="0"><img src="assets/logo.png"><div style="background:url('assets/fond 1.jpg')"></div></div>
<script>var tl = gsap.timeline({ paused: true }); tl.set({}, {}, 10); window.__timelines = window.__timelines || {}; ${timeline}</script></body></html>`;

describe("Motion Design compositions", () => {
  it("takes the last composition of an answer", () => {
    const answer = "Brouillon :\n```hyperframes\n<p>v1</p>\n```\nVersion finale :\n```hyperframes\n<p>v2</p>\n```";
    expect(extractComposition(answer)).toBe("<p>v2</p>");
    expect(extractComposition("Quel public visez-vous ?")).toBeNull();
  });

  it("reads the format, duration and files a composition uses", () => {
    const inspected = inspectComposition(composition());
    expect(inspected).toEqual({ ok: true, info: { id: "motion", format: "9:16", width: 1080, height: 1920, duration: 10, assets: ["logo.png", "fond 1.jpg"] } });
  });

  it("refuses what the worker could not render", () => {
    expect(inspectComposition("<p>no meta</p>")).toEqual({ ok: false, problems: ["no_composition"] });
    expect(inspectComposition(composition('data-width="1280" data-height="720" data-duration="10"'))).toEqual({ ok: false, problems: ["unsupported_size"] });
    expect(inspectComposition(composition('data-width="1920" data-height="1080" data-duration="90"'))).toEqual({ ok: false, problems: ["too_long"] });
    expect(inspectComposition(composition('data-width="1920" data-height="1080"'))).toEqual({ ok: false, problems: ["no_duration"] });
    expect(inspectComposition(composition(undefined, 'window.__timelines["other"] = tl;'))).toEqual({ ok: false, problems: ["no_timeline"] });
    expect(inspectComposition("x".repeat(130_000))).toEqual({ ok: false, problems: ["too_large"] });
  });

  it("removes outside scripts, links, redirects and base URLs, and puts our policy first", () => {
    const prepared = prepareComposition(composition(), {
      mode: "preview",
      gsap: "/* gsap */ var s = '</script>';",
      runtime: "/* runtime */",
      fontCss: fontCss({ latin: "data:font/woff2;base64,AA", latinExt: "data:font/woff2;base64,BB" }),
      assetUrl: (name) => (name === "logo.png" ? "data:image/png;base64,LOGO" : null),
    });
    expect(prepared).not.toMatch(/cdn\.jsdelivr|fonts\.googleapis|http-equiv="refresh"|<base/);
    const head = prepared.slice(prepared.indexOf("<head>") + 6);
    expect(head.startsWith(`<meta http-equiv="Content-Security-Policy" content="${compositionCsp("preview")}">`)).toBe(true);
    // Inlined code cannot close its own script tag.
    expect(prepared).toContain("var s = '<\\/script>';");
    expect(prepared).toContain('src="data:image/png;base64,LOGO"');
    // An image that is not attached stays a dead local reference (blocked by the policy).
    expect(prepared).toContain("url('assets/fond 1.jpg')");
    expect(prepared).toContain('font-family:"Inter"');
  });

  it("blocks every request in the preview and allows only the job folder in the worker", () => {
    expect(compositionCsp("preview")).toContain("default-src 'none'");
    expect(compositionCsp("preview")).toContain("connect-src 'none'");
    expect(compositionCsp("preview")).not.toContain("'self'");
    expect(compositionCsp("render")).toContain("script-src 'self' 'unsafe-inline'");
    expect(compositionCsp("render")).not.toMatch(/https?:|\*/);
    const forWorker = prepareComposition(composition(), { mode: "render", fontCss: "", assetUrl: (n) => `assets/${n}` });
    expect(forWorker).toContain('<script src="gsap.min.js"></script>');
    expect(forWorker).not.toContain("cdn.jsdelivr");
  });
});

const plan: EditPlan = {
  title: "Été",
  segments: [
    { clip: "plage.mp4", start: 1, end: 3.5 },
    { clip: "barres.mov", start: 0, end: 2 },
    { clip: "plage.mp4", start: 4, end: 9 },
  ],
  captions: [{ text: "Été 2026 : 100% soleil ; l'équipe \"Lumen\" — drawtext=fontfile=/etc/passwd", start: 0.2, end: 2.4 }],
  formats: ["16:9", "9:16", "1:1"],
  fit: "crop",
};

describe("Video Editor plans", () => {
  it("accepts a plan and finds it in an answer", () => {
    expect(editPlanSchema.safeParse(plan).success).toBe(true);
    expect(extractEditPlan(`Voici le montage.\n\`\`\`editplan\n${JSON.stringify(plan)}\n\`\`\``)).toEqual({ ok: true, plan });
    expect(extractEditPlan("Pas de plan")).toEqual({ ok: false, problem: "no_plan" });
    expect(extractEditPlan("```editplan\n{not json}\n```")).toEqual({ ok: false, problem: "invalid_plan" });
    expect(planDuration(plan)).toBe(9.5);
  });

  it("refuses plans the worker should not run", () => {
    const bad = (patch: Partial<EditPlan>) => editPlanSchema.safeParse({ ...plan, ...patch }).success;
    expect(bad({ formats: ["16:9", "16:9"] })).toBe(false);
    expect(bad({ formats: ["4:3" as never] })).toBe(false);
    expect(bad({ segments: [{ clip: "a.mp4", start: 2, end: 2.1 }] })).toBe(false);
    expect(bad({ segments: Array.from({ length: 31 }, () => ({ clip: "a.mp4", start: 0, end: 10 })) })).toBe(false); // 310 s
    expect(bad({ segments: [] })).toBe(false);
  });

  it("fits the plan to the real clips", () => {
    const fitted = fitPlanToClips(plan, {
      "plage.mp4": { path: "/x/0.mp4", duration: 6, hasAudio: true },
      "barres.mov": { path: "/x/1.mov", duration: 5, hasAudio: false },
    });
    expect(fitted.segments).toEqual([
      { clip: "plage.mp4", start: 1, end: 3.5 },
      { clip: "barres.mov", start: 0, end: 2 },
      { clip: "plage.mp4", start: 4, end: 6 },
    ]);
    const lost = fitPlanToClips(plan, { "plage.mp4": { path: "/x/0.mp4", duration: 1, hasAudio: true } });
    expect(lost.segments).toEqual([]);
  });

  it("builds FFmpeg arguments without a shell and without the caption text in the filter graph", () => {
    const clips = { "plage.mp4": { path: "/job/clips/0.mp4", duration: 12, hasAudio: true }, "barres.mov": { path: "/job/clips/1.mov", duration: 5, hasAudio: false } };
    const args = ffmpegArgs({ plan, clips, format: "9:16", output: "/job/out/9x16.mp4", fontFile: "/fonts/Inter.otf", captionFiles: ["/job/caption-0.txt"] });
    expect(args.filter((a) => a === "-i")).toHaveLength(2);
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 4)).toEqual(["-i", "/job/clips/0.mp4", "-i", "/job/clips/1.mov"]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920");
    expect(graph).toContain("[0:v]trim=start=1:end=3.5");
    expect(graph).toContain("[1:v]trim=start=0:end=2");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=2[a1]");
    expect(graph).toContain("concat=n=3:v=1:a=1[vc][ac]");
    expect(graph).toContain("textfile=/job/caption-0.txt:expansion=none");
    expect(args.join(" ")).not.toContain("soleil");
    expect(args.at(-1)).toBe("/job/out/9x16.mp4");
    const padded = ffmpegArgs({ plan: { ...plan, fit: "pad", captions: [] }, clips, format: "16:9", output: "o.mp4", fontFile: "f", captionFiles: [] });
    expect(padded[padded.indexOf("-filter_complex") + 1]).toContain("pad=1920:1080:(ow-iw)/2:(oh-ih)/2");
  });

  it("wraps captions to the frame width", () => {
    const text = "Été 2026 : 100% soleil ; l'équipe Lumen vous attend tout l'été sur la plage";
    const vertical = wrapCaption(text, "9:16").split("\n");
    const landscape = wrapCaption(text, "16:9").split("\n");
    expect(vertical.length).toBeGreaterThan(landscape.length);
    for (const line of vertical) expect(line.length).toBeLessThanOrEqual(33);
    expect(vertical.join(" ")).toBe(text);
  });
});

describe("formats, credits and files", () => {
  it("knows the three formats and computes credits like the database", () => {
    expect(formatOfSize(1080, 1080)).toBe("1:1");
    expect(formatOfSize(1280, 720)).toBeNull();
    expect(renderCredits(4, 9.5, 3)).toBe(114);
    expect(renderCredits(10, 15, 1)).toBe(150);
  });

  it("recognises real video files", () => {
    const mp4 = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
    expect(videoContentMatches(mp4, "mp4")).toBe(true);
    expect(videoContentMatches(mp4, "mov")).toBe(true);
    expect(videoContentMatches(webm, "webm")).toBe(true);
    expect(videoContentMatches(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]), "mp4")).toBe(false);
    expect(videoExtensionOf("Clip Final.MOV")).toBe("mov");
    expect(videoExtensionOf("clip.avi")).toBeNull();
  });

  it("describes a video to the model without sending it", () => {
    const built = buildChatContext({
      system: "s",
      budgetTokens: 10_000,
      history: [{ role: "user", text: "Monte ces clips", attachments: [{ filename: "plage.mp4", kind: "video", media: { duration: 12.43, width: 1920, height: 1080 } }] }],
    });
    const text = JSON.stringify(built.messages);
    expect(text).toContain('[Video \\"plage.mp4\\": 12.4 s, 1920×1080. Its pictures and sound are not available to you.]');
    expect(built.messages.flatMap((m) => m.content).every((p) => p.type === "text")).toBe(true);
  });
});

describe("reading a video's header", () => {
  it("finds the duration and size of MP4 and MOV files, with the index at the start or at the end", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { readMp4Media } = await import("@/modules/render/mp4-info");
    const dir = mkdtempSync(`${tmpdir()}/mp4-`);
    const cases = [
      { file: `${dir}/start.mp4`, extra: ["-movflags", "+faststart"] },
      { file: `${dir}/end.mp4`, extra: [] },
      { file: `${dir}/clip.mov`, extra: [] },
    ];
    for (const c of cases) {
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", ...c.extra, c.file]);
      const bytes = readFileSync(c.file);
      const media = await readMp4Media(async (offset, length) => new Uint8Array(bytes.subarray(offset, offset + length)), bytes.length);
      expect(media).toMatchObject({ width: 640, height: 360 });
      expect(media!.duration).toBeCloseTo(2.5, 1);
    }
    expect(await readMp4Media(async () => new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]), 8)).toBeNull();
  });
});
