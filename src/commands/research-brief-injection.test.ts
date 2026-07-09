/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { researchCommandHandler } from "./research.js";
import { ResearchScaffolder } from "../engine/research-scaffold.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import * as fsPromises from "node:fs/promises";
import * as fsSync from "node:fs";

vi.mock("node:fs/promises");
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock ResearchScaffolder with resolve support
vi.mock("../engine/research-scaffold.js", () => {
  return {
    ResearchScaffolder: vi.fn().mockImplementation(() => {
      return {
        scaffold: vi.fn().mockResolvedValue({
          directory: "docs/research/R011-obsidian-vault",
        }),
        resolveByPrefix: vi.fn().mockResolvedValue({
          directory: "docs/research/R011-obsidian-vault",
        }),
      };
    }),
  };
});

// Mock WorkflowRuntime
vi.mock("../plugins/workflow-runtime.js", () => {
  return {
    WorkflowRuntime: vi.fn().mockImplementation(() => {
      return {
        executeWorkflow: vi.fn().mockResolvedValue({
          summary: "Research complete.",
          intents: [],
          summaries: [],
          logPath: "/tmp/fake.log",
        }),
      };
    }),
  };
});

// Mock config + model resolution — research resolves the configured define
// agent before dispatching. Mocked here so the suite stays hermetic (this
// file mocks node:fs, which would otherwise break the real loadConfig).
vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(() => ({ agents: { define: "claude" } })),
}));
vi.mock("../utils/resolve-model.js", () => ({
  resolveModelForTask: vi.fn(() => "claude-opus-4-8"),
}));

/**
 * RED tests for the research command audit fixes:
 * 1. --run must read brief.md and pass its content to the workflow
 * 2. Prefix input (R011) must resolve existing dir, not scaffold new
 * 3. --run on existing research must not re-scaffold
 */
describe("Research Command Brief Injection (Audit Fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("--run reads brief.md content and passes it to the workflow", async () => {
    const briefContent = `---
initiative: obsidian-vault
methodology: technical
---
# R011: Obsidian Vault
## Objective
Design the plugin architecture.
## Research Questions
1. What does ExtensionManifestSchema need?
`;
    (fsPromises.readFile as any).mockResolvedValue(briefContent);

    await researchCommandHandler({
      initiative: "obsidian-vault",
      methodology: "technical",
      run: true,
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;

    // The workflow must receive the ACTUAL brief content, not a one-liner
    const callArgs = runtimeInstance.executeWorkflow.mock.calls[0];
    expect(callArgs[0]).toBe("gwrk-research-technical");
    // The input must contain the brief content
    expect(callArgs[1]).toContain("ExtensionManifestSchema");
    expect(callArgs[1]).toContain("Design the plugin architecture");
    // It must NOT be just the one-liner
    expect(callArgs[1]).not.toBe(
      expect.stringMatching(/^Execute research for initiative/),
    );
  });

  it("prefix input (R011) resolves existing dir via resolveByPrefix", async () => {
    await researchCommandHandler({
      initiative: "R011",
      run: true,
    });

    const ScaffolderMock = ResearchScaffolder as any;
    const scaffolderInstance = ScaffolderMock.mock.results[0].value;

    // Should call resolveByPrefix, not scaffold
    expect(scaffolderInstance.resolveByPrefix).toHaveBeenCalledWith("R011");
    expect(scaffolderInstance.scaffold).not.toHaveBeenCalled();
  });

  it("prefix input without --run resolves and reports existing dir", async () => {
    const result = await researchCommandHandler({
      initiative: "R011",
    });

    const ScaffolderMock = ResearchScaffolder as any;
    const scaffolderInstance = ScaffolderMock.mock.results[0].value;

    expect(scaffolderInstance.resolveByPrefix).toHaveBeenCalledWith("R011");
    expect(result).toContain("R011-obsidian-vault");
  });

  it("--refs injects reference document content into workflow input", async () => {
    const briefContent = "# Research Brief\n## Questions\n1. How?";
    const refsContent = "# Reference Notes\nImportant context about the domain.";
    (fsPromises.readFile as any).mockResolvedValue(briefContent);
    (fsSync.existsSync as any).mockReturnValue(true);
    (fsSync.readFileSync as any).mockReturnValue(refsContent);

    await researchCommandHandler({
      initiative: "obsidian-vault",
      run: true,
      refs: "docs/research/R011/references/notes.md",
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;

    const callArgs = runtimeInstance.executeWorkflow.mock.calls[0];
    // Refs content must be wrapped in XML tags
    expect(callArgs[1]).toContain("<reference_document");
    expect(callArgs[1]).toContain("Important context about the domain");
    expect(callArgs[1]).toContain("</reference_document>");
    // Brief content must also be present
    expect(callArgs[1]).toContain("How?");
  });
});
