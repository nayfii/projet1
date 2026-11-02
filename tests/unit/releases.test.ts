import { describe, expect, it } from "vitest";
import { nextVersion } from "@/lib/version";
import { nextVersion as scriptNextVersion } from "../../scripts/release/version.mjs";
import { fixStatus, runStatus } from "@/modules/platform/releases";

describe("version numbers", () => {
  it("go v1.0 → v1.1 → … → v1.9 → v1.10, the same in the app and in the launch workflow", () => {
    for (const [current, next] of [["1.0", "1.1"], ["v1.1", "1.2"], ["1.9", "1.10"], ["2.14", "2.15"], ["oops", "1.1"]]) {
      expect(nextVersion(current)).toBe(next);
      expect(scriptNextVersion(current)).toBe(next);
    }
  });
});

describe("what the console shows", () => {
  const created = new Date("2026-11-02T10:00:00Z").toISOString();
  const now = new Date("2026-11-02T10:01:00Z").getTime();
  const later = new Date("2026-11-02T11:00:00Z").getTime();
  it("for a launch or a check run", () => {
    expect(runStatus({ status: "in_progress", conclusion: null })).toBe("running");
    expect(runStatus({ status: "completed", conclusion: "success" })).toBe("succeeded");
    expect(runStatus({ status: "completed", conclusion: "failure" })).toBe("failed");
  });
  it("for a change asked of Claude Code", () => {
    expect(fixStatus(null, null, created, now)).toBe("sending");
    expect(fixStatus(null, null, created, later)).toBe("not_sent");
    expect(fixStatus({ status: "in_progress", conclusion: null }, null, created, now)).toBe("working");
    expect(fixStatus({ status: "completed", conclusion: "success" }, { state: "open", merged: false, draft: false }, created)).toBe("ready");
    expect(fixStatus({ status: "completed", conclusion: "failure" }, { state: "open", merged: false, draft: true }, created)).toBe("checks_failed");
    expect(fixStatus({ status: "completed", conclusion: "success" }, null, created)).toBe("no_change");
    expect(fixStatus({ status: "completed", conclusion: "failure" }, null, created)).toBe("failed");
    expect(fixStatus({ status: "completed", conclusion: "success" }, { state: "closed", merged: true, draft: false }, created)).toBe("accepted");
    expect(fixStatus(null, { state: "closed", merged: false, draft: false }, created)).toBe("rejected");
  });
});
