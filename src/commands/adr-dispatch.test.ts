/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 029 Decision Records — RED tests for TR-004 (FR-007).
 *
 * @phase 03
 * @status active
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

  it("FR-007: dispatches gwrk-adr-record through WorkflowRuntime", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records", run: true });

    expect(runtimeMock.WorkflowRuntime).toHaveBeenCalled();
    expect(runtimeMock.executeWorkflow).toHaveBeenCalledWith(
      "gwrk-adr-record",
      expect.any(String),
      expect.objectContaining({ agent: "claude", model: "claude-opus-4-8" }),
    );
  });

  it("FR-007: passes the title in the workflow input", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records", run: true });
    const input = String(runtimeMock.executeWorkflow.mock.calls[0][1]);

    expect(input).toContain("Decision Records");
    // The prompt carries no substitution token (TC-008), so the target path
    // arrives as appended text rather than an interpolated placeholder.
    expect(input).toContain("ADR-010-decision-records.md");
    expect(input).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("FR-007: passes projectRoot so project-local overrides resolve", async () => {
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

  it("FR-002: reads config from the project root, not the working directory", async () => {
    const { adrCommandHandler } = await load();
    const { loadConfig } = await import("../utils/config.js");
    const { resolveModelForTask } = await import("../utils/resolve-model.js");

    // `loadConfig` joins its argument with `.gwrkrc.json` and does not walk
    // parents, so handing it `cwd` breaks `--run` from every subdirectory
    // (US-001 AC-3, SC-001). `resolveModelForTask` fails silently the same way:
    // its registry read is caught, so a project-local model just vanishes.
    await adrCommandHandler({
      target: "Decision Records",
      run: true,
      cwd: "/repo/src/deep",
    });

    expect(vi.mocked(loadConfig)).toHaveBeenCalledWith("/repo");
    expect(vi.mocked(resolveModelForTask)).toHaveBeenCalledWith(
      "define",
      "claude",
      "/repo",
    );
  });

  it("FR-007: never constructs the runtime without --run", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ target: "Decision Records" });

    expect(runtimeMock.WorkflowRuntime).not.toHaveBeenCalled();
    expect(runtimeMock.executeWorkflow).not.toHaveBeenCalled();
  });

  it("FR-007: never constructs the runtime for --print", async () => {
    const { adrCommandHandler } = await load();

    await adrCommandHandler({ print: true });

    expect(runtimeMock.WorkflowRuntime).not.toHaveBeenCalled();
  });

  it("FR-007: reports a workflow the loader cannot resolve with the build command", async () => {
    const { adrCommandHandler } = await load();

    runtimeMock.executeWorkflow.mockRejectedValue(
      new Error("Plugin not found: gwrk-adr-record"),
    );

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/Workflow not found: gwrk-adr-record\. Run: npm run build/);
  });

  it("FR-007: rejects a workflow result missing summary or intents", async () => {
    const { adrCommandHandler } = await load();

    runtimeMock.executeWorkflow.mockResolvedValue({ summary: "Drafted." });

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/gwrk-adr-record returned no valid \{summary, intents\}/);
  });

  it("FR-007: rejects when no agent backend is configured", async () => {
    const { adrCommandHandler } = await load();
    const { loadConfig } = await import("../utils/config.js");

    vi.mocked(loadConfig).mockReturnValue({ agents: {} } as never);

    await expect(
      adrCommandHandler({ target: "Decision Records", run: true }),
    ).rejects.toThrow(/No agent backend available\. Run: gwrk plugin list agents/);
    expect(runtimeMock.executeWorkflow).not.toHaveBeenCalled();
  });
});

/**
 * FR-003/FR-007: the prompt must describe the record `renderTemplate()` writes.
 * Step 6 has the workflow emit a full-file `WRITE_FILE`, so any section the
 * prompt fails to name is a section the drafted record drops — and `--amend`
 * (FR-022) then has no `## Amendments` registry to resolve against.
 *
 * `node:fs` is not mocked here; only `node:fs/promises` is.
 */
describe("029 FR-003: PROMPT.md agrees with renderTemplate()", () => {
  const promptPath = new URL(
    "../plugins/builtins/workflows/gwrk-adr-record/PROMPT.md",
    import.meta.url,
  );

  it("names every `## ` heading the scaffold emits", async () => {
    const { readFileSync } = await import("node:fs");
    const scaffoldModule = await vi.importActual<
      typeof import("../engine/adr-scaffold.js")
    >("../engine/adr-scaffold.js");

    const template = scaffoldModule.renderTemplate({
      number: "010",
      title: "Decision Records",
      date: "2026-08-27",
    });
    const headings = template
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());

    expect(headings).toContain("7. References");
    expect(headings).toContain("Amendments");

    const prompt = readFileSync(promptPath, "utf8");
    // Match the `## Heading` form, not the bare name: the prompt mentions
    // "Amendments" in prose regardless of whether it names the registry.
    const missing = headings.filter(
      (heading) => !prompt.includes(`## ${heading}`),
    );
    expect(missing).toEqual([]);
  });
});
