/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordGateResult } from "../db/gates.js";
import { reconcileGates } from "./reconcile-gates.js";
vi.mock("../db/gates.js", () => ({ recordGateResult: vi.fn() }));
vi.mock("../utils/project-id.js", () => ({ resolveProjectId: vi.fn(() => "checkout-identity") }));
let root: string;
let statePath: string;
beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), "gwrk-merge-gates-"));
  const feature = join(root, "specs/001-fixture/.gwrk");
  mkdirSync(feature, { recursive: true });
  statePath = join(feature, "tasks.json");
  writeFileSync(join(root, "identity.txt"), "merge-checkout");
  writeFileSync(statePath, JSON.stringify({
    featureId: "001-fixture", createdAt: "2026-11-18T00:00:00.000Z",
    phases: [{ id: "phase-01", title: "Verify merged source", tasks: [
      { id: "T001", title: "Source check", description: "", status: "open", gateScript: 'test "$(cat identity.txt)" = merge-checkout' },
      { id: "T002", title: "Failure", description: "", status: "open", gateScript: "false" },
      { id: "T003", title: "Cancelled", description: "", status: "cancelled", gateScript: "false" }
    ] }]
  }, null, 2));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
it("verifies the merge checkout without rewriting task state and records enrollment-scoped evidence", async () => {
  const before = readFileSync(statePath);
  const result = await reconcileGates(root, "001-fixture", "phase-01", {
    projectId: "enrolled-alpha", updateLocalTaskState: false,
  });
  expect.soft(result).toEqual({ passed: 1, failed: 1, total: 3, failedTaskIds: ["T002"] });
  expect.soft(readFileSync(statePath)).toEqual(before);
  expect.soft(vi.mocked(recordGateResult).mock.calls.map((call) => call[1])).toEqual(["enrolled-alpha", "enrolled-alpha"]);
});
it("retains local task promotion when explicitly requested", async () => {
  await reconcileGates(root, "001-fixture", "phase-01", {
    projectId: "enrolled-alpha", updateLocalTaskState: true,
  });
  const tasks = JSON.parse(readFileSync(statePath, "utf8")).phases[0].tasks;
  expect(tasks[0].status).toBe("completed");
  expect(tasks[1].status).toBe("open");
  expect(tasks[2].status).toBe("cancelled");
});
