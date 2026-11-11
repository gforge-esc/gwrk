/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installArchitectureContext } from "../adapters/architecture/context-files.js";
import { resolveDesign } from "../domain/architecture-context.js";
import { assessProject } from "./assess.js";
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("../plugins/workflow-runtime.js", () => ({ WorkflowRuntime: class { executeWorkflow = dispatch; } }));
vi.mock("../utils/resolve-agent.js", () => ({ resolveAgent: () => ({ backend: "agy", model: "default" }) }));
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-assess-"));
  await fs.writeFile(path.join(root, ".gwrkrc.json"), JSON.stringify({ project: { name: "fixture" } }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src/policy.ts"), "export const read = () => Date.now();\n");
  await installArchitectureContext(root, { projectName: "fixture", design: resolveDesign({ architecture: "hexagonal-functional" }), decisionsDir: "docs/decisions" });
  dispatch.mockReset();
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
function response() {
  return { summary: "Found a clock effect", intents: [], output: { assessment: { overview: "Clock effect violates the target", inspected: ["src/policy.ts"], limitations: ["No runtime tests executed"], findings: [{ id: "F1", rule: "Pure core", description: "Clock read", evidence: [{ file: "src/policy.ts", line: 1, observation: "Date.now reads the clock" }] }], features: [{ id: "clock-port", title: "Inject time", summary: "Pass time as input", dependsOn: [], findingIds: ["F1"], changes: ["Pass current time from adapter"], acceptance: ["Equal inputs return equal results"] }], reconciliation: [] } } };
}
describe("gwrk assess", () => {
  it("recovers an observed agy response and records its origin", async () => {
    const file = "recorded.jsonl";
    await fs.writeFile(path.join(root, file), JSON.stringify({ event: "result", result: { status: "SUCCESS", response: JSON.stringify({ summary: "Recovered", intents: [] }) } }));
    dispatch.mockResolvedValue(response());
    await assessProject({ cwd: root, output: "recovered", fromLog: file });
    expect(dispatch).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ reportOnly: true, recordedResult: expect.objectContaining({ unwrappedStdout: '{"summary":"Recovered","intents":[]}' }) }));
    const provenance = JSON.parse(await fs.readFile(path.join(root, "recovered/provenance.json"), "utf8"));
    expect(provenance.recoveredFrom).toBe(file);
    expect(provenance.recordedOutputHash).toHaveLength(64);
  });

  it("rejects incomplete recorded streams before dispatch", async () => {
    await fs.writeFile(path.join(root, "partial.jsonl"), '{"summary":"partial","intents":[]}');
    await expect(assessProject({ cwd: root, output: "recovered", fromLog: "partial.jsonl" })).rejects.toThrow(/terminal status/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("prints the target without dispatching", async () => {
    expect((await assessProject({ cwd: root, print: true })).prompt).toContain("hexagonal-functional");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("uses the configured backend and persists report, feature specs and reference", async () => {
    dispatch.mockResolvedValue(response());
    await fs.writeFile(path.join(root, "prior.md"), "Previous notes\n");
    const result = await assessProject({ cwd: root, output: "assessment", refs: ["prior.md"] });
    expect(result.features).toBe(1);
    expect(dispatch).toHaveBeenCalledWith("gwrk-architecture-assessment", expect.any(String), expect.objectContaining({ agent: "agy", projectRoot: root, reportOnly: true }));
    expect(await fs.readFile(path.join(root, "assessment/specs/01-clock-port/spec.md"), "utf8")).toContain("Equal inputs");
    expect(await fs.readFile(path.join(root, "assessment/reference-1.md"), "utf8")).toBe("Previous notes\n");
    expect(JSON.parse(await fs.readFile(path.join(root, "assessment/provenance.json"), "utf8")).sourceHashes["src/policy.ts"]).toHaveLength(64);
    expect(await fs.readFile(path.join(root, "src/policy.ts"), "utf8")).toBe("export const read = () => Date.now();\n");
  });
  it("rejects invented evidence locations without writing results", async () => {
    const data = response(); data.output.assessment.findings[0].evidence[0].line = 100;
    dispatch.mockResolvedValue(data);
    await expect(assessProject({ cwd: root, output: "assessment" })).rejects.toThrow(/Evidence line/);
    await expect(fs.access(path.join(root, "assessment"))).rejects.toThrow();
  });
  it("rejects missing reconciliation of a prior gap", async () => {
    await fs.writeFile(path.join(root, "prior.md"), "## Gaps and consequences\n\n| Gap | Evidence | Consequence |\n|---|---|---|\n| Hidden state | module variable | order dependence |\n");
    dispatch.mockResolvedValue(response());
    await expect(assessProject({ cwd: root, output: "assessment", refs: ["prior.md"] })).rejects.toThrow(/Prior gap not reconciled/);
  });
  it("rejects prose recovery and preserves an existing output directory", async () => {
    dispatch.mockResolvedValue({ summary: "native success", intents: [] });
    await expect(assessProject({ cwd: root, output: "assessment" })).rejects.toThrow();
    await fs.mkdir(path.join(root, "assessment"));
    dispatch.mockReset();
    await expect(assessProject({ cwd: root, output: "assessment" })).rejects.toThrow(/already exists/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
