/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `define ontology --run` dispatched to whatever the agent layer defaults to.
 *
 * The handler passed `agent: options.agent` straight through, so without an
 * explicit `--agent` the value was undefined and `agent.ts:527` fell back to its
 * hardcoded `"agy"`. On a machine where agy is not installed the dispatch died
 * in ~107ms with `Workflow execution failed with exit code 1` and no detail,
 * whatever `agents.define` said in config. `define research --run` resolves the
 * configured backend; this one did not.
 *
 * `--refs` was never declared on the subcommand either, so the flag bound to the
 * parent `define` command and was silently dropped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REFS_BODY = "Daybook keeps a journal entry per day.";
const PATTERN_BODY = "Repository pattern in src/db.";

/** Wire the module graph and return the executeWorkflow spy. */
async function load(opts: { cwd: string }) {
  vi.resetModules();

  const executeWorkflow = vi
    .fn()
    .mockResolvedValue({ summary: "ok", intents: [] });

  vi.doMock("../engine/ontology-scaffold.js", () => ({
    scaffold: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("../engine/source-scanner.js", () => ({
    scan: vi.fn().mockResolvedValue({
      specs: [],
      architecture: "Arch",
      patterns: [PATTERN_BODY],
    }),
  }));
  vi.doMock("../plugins/workflow-runtime.js", () => ({
    WorkflowRuntime: vi.fn(() => ({ executeWorkflow })),
  }));
  // The registry has to be present: `resolveAgent` skips model resolution
  // without one, because `loadRegistry` process.exits on a config that lacks it.
  vi.doMock("../utils/config.js", () => ({
    loadConfig: vi.fn(() => ({
      agents: {
        define: "claude",
        registry: { claude: { name: "claude", models: [] } },
        fallbackOrder: ["claude"],
      },
    })),
  }));
  vi.doMock("../utils/resolve-model.js", () => ({
    resolveModelForTask: vi.fn(() => "sonnet-from-registry"),
  }));

  vi.spyOn(process, "cwd").mockReturnValue(opts.cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});

  const mod = await import("./define-ontology.js");
  return { defineOntologyCommand: mod.defineOntologyCommand, executeWorkflow };
}

let tempDir: string;

beforeEach(() => {
  vi.restoreAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-ontology-"));
});

describe("define ontology --run backend resolution", () => {
  it("dispatches to the configured backend, not the agent-layer default", async () => {
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true });

    expect(executeWorkflow).toHaveBeenCalled();
    const options = executeWorkflow.mock.calls[0][2];
    expect(options.agent).toBe("claude");
  });

  it("resolves a model for the task rather than leaving it undefined", async () => {
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true });

    expect(executeWorkflow.mock.calls[0][2].model).toBe("sonnet-from-registry");
  });

  it("lets an explicit --agent override the configured backend", async () => {
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true, agent: "codex" });

    expect(executeWorkflow.mock.calls[0][2].agent).toBe("codex");
  });
});

describe("define ontology --refs", () => {
  it("prepends the contents of a reference file", async () => {
    const refFile = path.join(tempDir, "notes.md");
    fs.writeFileSync(refFile, REFS_BODY);
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true, refs: refFile });

    const input = String(executeWorkflow.mock.calls[0][1]);
    expect(input).toContain(REFS_BODY);
    // The grounding scan still reaches the workflow alongside the refs.
    expect(input).toContain(PATTERN_BODY);
  });

  it("reads every file in a reference directory", async () => {
    // The form that failed: `--refs discovery`, a folder of notes.
    const dir = path.join(tempDir, "discovery");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "a.md"), "Entries are dated.");
    fs.writeFileSync(path.join(dir, "b.md"), "Tags group entries.");
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true, refs: dir });

    const input = String(executeWorkflow.mock.calls[0][1]);
    expect(input).toContain("Entries are dated.");
    expect(input).toContain("Tags group entries.");
  });

  it("names each reference file so the agent can cite it", async () => {
    const dir = path.join(tempDir, "discovery");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "domain.md"), REFS_BODY);
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });

    await defineOntologyCommand({ run: true, refs: dir });

    expect(String(executeWorkflow.mock.calls[0][1])).toContain("domain.md");
  });

  it("fails loudly when the reference path does not exist", async () => {
    // Silent omission is the defect being closed. A typo must not look like a
    // successful run over material the agent never saw. `withSignal` converts
    // the CommandError into an exit code rather than rethrowing, so the
    // observable contract is exit 1 with nothing dispatched.
    const { defineOntologyCommand, executeWorkflow } = await load({
      cwd: tempDir,
    });
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await defineOntologyCommand({ run: true, refs: path.join(tempDir, "nope") });

    expect(process.exitCode).toBe(1);
    expect(executeWorkflow).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "nope",
    );
    process.exitCode = 0;
  });
});
