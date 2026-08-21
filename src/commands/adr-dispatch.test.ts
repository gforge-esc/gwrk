/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-004 (FR-007).
 *
 * @phase 03
 * @status red
 *
 * Per `research-dispatch.test.ts`: mock `WorkflowRuntime`, `node:fs/promises`,
 * `loadConfig` and `resolveModelForTask`. All dispatch goes through
 * `WorkflowRuntime.executeWorkflow` — never a raw spawn (ADR-007).
 *
 * Phase 11 amends this file with the `--audit` cases (FR-027). The test
 * activator is file-scoped, so two phases cannot share one file — see
 * `gap-matrix.md`.
 *
 * The module under test is loaded with a dynamic `import` inside each test: a
 * top-level static import of a file that does not exist yet fails at COLLECTION,
 * which reports `Tests  no tests` and trips the ADR-005 §10.2.1 liveness check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises");

const runtimeMock = vi.hoisted(() => {
  const executeWorkflow = vi.fn();
  const WorkflowRuntime = vi.fn(() => ({ executeWorkflow }));
  return { executeWorkflow, WorkflowRuntime };
});
vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: runtimeMock.WorkflowRuntime,
}));

const scaffoldMock = vi.hoisted(() => ({
  scaffold: vi.fn(),
  renderTemplate: vi.fn(() => "# ADR-010: Decision Records\n"),
  findProjectRoot: vi.fn(),
  resolveDecisionsDir: vi.fn(),
  allocateNumber: vi.fn(),
}));
vi.mock("../engine/adr-scaffold.js", () => scaffoldMock);

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(() => ({ agents: { define: "claude" } })),
}));
vi.mock("../utils/resolve-model.js", () => ({
  resolveModelForTask: vi.fn(() => "claude-opus-4-8"),
}));

const load = () => import("./adr.js");

describe("029 FR-007: --run dispatches gwrk-adr-record (US-003)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scaffoldMock.scaffold.mockResolvedValue({
      filePath: "/repo/docs/decisions/ADR-010-decision-records.md",
      id: "ADR-010",
      number: "010",
      slug: "decision-records",
    });
    scaffoldMock.findProjectRoot.mockResolvedValue("/repo");
    scaffoldMock.resolveDecisionsDir.mockResolvedValue("/repo/docs/decisions");
    scaffoldMock.allocateNumber.mockResolvedValue("010");
    runtimeMock.executeWorkflow.mockResolvedValue({
      summary: "Drafted ADR-010.",
      intents: [],
    });
  });

  it.skip("FR-007: dispatches gwrk-adr-record through WorkflowRuntime", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records", run: true });

    expect(runtimeMock.WorkflowRuntime).toHaveBeenCalled();
    expect(runtimeMock.executeWorkflow).toHaveBeenCalledWith(
      "gwrk-adr-record",
      expect.any(String),
      expect.objectContaining({ agent: "claude", model: "claude-opus-4-8" }),
    );
  });

  it.skip("FR-007: passes the title in the workflow input", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records", run: true });
    const input = String(runtimeMock.executeWorkflow.mock.calls[0][1]);

    expect(input).toContain("Decision Records");
    // The prompt carries no substitution token (TC-008), so the target path
    // arrives as appended text rather than an interpolated placeholder.
    expect(input).toContain("ADR-010-decision-records.md");
    expect(input).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it.skip("FR-007: passes projectRoot so project-local overrides resolve", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records", run: true });
    const options = runtimeMock.executeWorkflow.mock.calls[0][2] as Record<
      string,
      unknown
    >;

    // Deliberate divergence from `define research --run`, which omits it and so
    // falls back to a default PluginLoader with no projectDir, making
    // project-local overrides invisible.
    expect(options.projectRoot).toBeTruthy();
    expect(String(options.projectRoot)).toBe("/repo");
  });

  it.skip("FR-007: never constructs the runtime without --run", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records" });

    expect(runtimeMock.WorkflowRuntime).not.toHaveBeenCalled();
    expect(runtimeMock.executeWorkflow).not.toHaveBeenCalled();
  });

  it.skip("FR-007: never constructs the runtime for --print", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ print: true });

    expect(runtimeMock.WorkflowRuntime).not.toHaveBeenCalled();
  });

  it.skip("FR-007: reports a workflow the loader cannot resolve with the build command", async () => {
    const { adrCommandHandler } = await load();

    runtimeMock.executeWorkflow.mockRejectedValue(
      new Error("Plugin not found: gwrk-adr-record"),
    );

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/Workflow not found: gwrk-adr-record\. Run: npm run build/);
  });

  it.skip("FR-007: rejects a workflow result missing summary or intents", async () => {
    const { adrCommandHandler } = await load();

    runtimeMock.executeWorkflow.mockResolvedValue({ summary: "Drafted." });

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/gwrk-adr-record returned no valid \{summary, intents\}/);
  });

  it.skip("FR-007: rejects when no agent backend is configured", async () => {
    const { adrCommandHandler } = await load();
    const { loadConfig } = await import("../utils/config.js");

    vi.mocked(loadConfig).mockReturnValue({ agents: {} } as never);

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/No agent backend available\. Run: gwrk plugin list agents/);
    expect(runtimeMock.executeWorkflow).not.toHaveBeenCalled();
  });
});
