import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planToTasks } from "../src/engine/plan-to-tasks.js";

describe("plan-to-tasks phase heading separators", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-plan-heading-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePlan(body: string): void {
    fs.writeFileSync(path.join(dir, "plan.md"), body, "utf-8");
  }

  it("parses phases separated by an em-dash", () => {
    writePlan(
      [
        "# Plan",
        "",
        "### Phase 1 — The single config reader",
        "**Files (1):**",
        "- `src/config/env.js` (create: config reader)",
        "",
        "### Phase 2 — Config gate hardening",
        "**Files (1):**",
        "- `scripts/config-inspect.sh` (amend: add scans)",
        "",
      ].join("\n"),
    );

    const state = planToTasks(dir, "001-platform-foundation");
    expect(state.phases).toHaveLength(2);
    expect(state.phases[0].title).toBe("The single config reader");
    expect(state.phases[1].title).toBe("Config gate hardening");
  });

  it("still parses phases separated by a colon", () => {
    writePlan(
      [
        "# Plan",
        "",
        "### Phase 1: The single config reader",
        "**Files (1):**",
        "- `src/config/env.js` (create: config reader)",
        "",
      ].join("\n"),
    );

    const state = planToTasks(dir, "001-platform-foundation");
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0].title).toBe("The single config reader");
  });
});
