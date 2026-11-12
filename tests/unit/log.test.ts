import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, logFields } from "@/lib/log";
import { classifyClock, classifyWorkflowQueue } from "@/modules/platform/health";

describe("structured logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keep codes, numbers and ids; drop what usually carries content or personal data", () => {
    const fields = logFields({
      provider: "google",
      ms: 12.3456,
      ok: true,
      content: "Le devis pour Atlas",
      email: "a@b.test",
      prompt: "secret prompt",
      token: "at-123",
      name: "Claire",
      "bad key": "x",
      missing: undefined,
      nan: Number.NaN,
    });
    expect(fields).toEqual({ provider: "google", ms: 12.35, ok: true, nan: null });
  });

  it("cut long strings and write one JSON line at the right level", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("error", "workflow.run_finished", { code: "x".repeat(500), run: "r1" });
    logEvent("info", "cron.tick", { scheduled: 2 });
    const line = JSON.parse(String(error.mock.calls[0][0]));
    expect(line).toMatchObject({ level: "error", event: "workflow.run_finished", run: "r1" });
    expect(line.code.length).toBeLessThanOrEqual(121);
    expect(typeof line.at).toBe("string");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ level: "info", event: "cron.tick", scheduled: 2 });
  });
});

describe("operations status", () => {
  const now = Date.parse("2026-11-18T10:00:00Z");
  it("calls the clock late after 15 minutes, and says when it never ran", () => {
    expect(classifyClock(null, now)).toBe("never");
    expect(classifyClock("2026-11-18T09:50:00Z", now)).toBe("on_time");
    expect(classifyClock("2026-11-18T09:40:00Z", now)).toBe("late");
  });
  it("calls the queue stuck when a run lost its executor or waits too long", () => {
    const base = { active: 1, queued: 0, waiting: 0, running: 0, stuck: 0, oldest_queued_at: null, succeeded: 0, failed: 0, top_error: null };
    expect(classifyWorkflowQueue(base, now)).toBe("idle");
    expect(classifyWorkflowQueue({ ...base, running: 1 }, now)).toBe("working");
    expect(classifyWorkflowQueue({ ...base, stuck: 1 }, now)).toBe("stuck");
    expect(classifyWorkflowQueue({ ...base, queued: 1, oldest_queued_at: "2026-11-18T09:30:00Z" }, now)).toBe("stuck");
  });
});
