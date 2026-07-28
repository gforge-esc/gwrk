/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcileGates } from "./reconcile-gates.js";
import * as state from "../utils/state.js";
import * as gatesDb from "../db/gates.js";
import * as projectId from "../utils/project-id.js";

vi.mock("../utils/state.js");
vi.mock("../db/gates.js");
vi.mock("../utils/project-id.js");

// Real inline execution: projectPath = the repo root (a real cwd), featureId a
// non-existent spec dir so no convention/file gate resolves → inline strategy.
const ROOT = process.cwd();

describe("reconcileGates (026 — harvest verifies inline gates, not ENOENT false-FAILs)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectId.resolveProjectId).mockReturnValue("proj");
    vi.mocked(gatesDb.recordGateResult).mockReturnValue(undefined as never);
    vi.mocked(state.saveTaskState).mockReturnValue(undefined as never);
  });

  it("passes an inline gate that exits 0 — the old path-only runner recorded ENOENT 127", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [
        { id: "phase-01", tasks: [{ id: "T001", status: "completed", gateScript: "true" }] },
      ],
    } as never);

    const r = await reconcileGates(ROOT, "026-nonexistent", "phase-01");

    expect(r.passed).toBe(1);
    expect(r.failed).toBe(0);
    const rec = vi.mocked(gatesDb.recordGateResult).mock.calls[0][0] as {
      exit_code: number;
      passed: number;
    };
    expect(rec.exit_code).toBe(0);
    expect(rec.passed).toBe(1);
  });

  it("fails an inline gate that exits non-zero", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [
        { id: "phase-01", tasks: [{ id: "T001", status: "completed", gateScript: "false" }] },
      ],
    } as never);

    const r = await reconcileGates(ROOT, "026-nonexistent", "phase-01");

    expect(r.failed).toBe(1);
    expect(r.passed).toBe(0);
  });

  it("runs a phase's shared gate once across tasks (dedupe)", async () => {
    const gate = 'grep -q zzz /dev/null || true'; // trivially passes, not hollow
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-01",
          tasks: [
            { id: "T001", status: "completed", gateScript: gate },
            { id: "T002", status: "completed", gateScript: gate },
            { id: "T003", status: "completed", gateScript: gate },
          ],
        },
      ],
    } as never);

    const r = await reconcileGates(ROOT, "026-nonexistent", "phase-01");

    // All three tasks recorded, but the shared gate ran once (evidence per task).
    expect(r.total).toBe(3);
    expect(vi.mocked(gatesDb.recordGateResult)).toHaveBeenCalledTimes(3);
  });
});
