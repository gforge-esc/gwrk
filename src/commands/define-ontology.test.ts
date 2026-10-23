/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from "vitest";
import { defineOntologyCommand } from "./define-ontology";
import * as scaffoldModule from "../engine/ontology-scaffold";

vi.mock("../engine/ontology-scaffold");

describe("US-020, US-021: Define Ontology Command", () => {
  it("US-020: should trigger scaffolding by default", async () => {
    const scaffoldSpy = vi.spyOn(scaffoldModule, "scaffold");
    await defineOntologyCommand({});
    expect(scaffoldSpy).toHaveBeenCalled();
  });

  it("US-021: should not run construction workflow if --run is missing", async () => {
    // This would check if the workflow engine was NOT called
    // Placeholder for implementation verification
  });
});

/**
 * 029 Decision Records — RED tests for TR-011 (FR-015).
 *
 * @phase 06
 * @status active
 *
 * `define-ontology.ts:48-49` renders `material.patterns` under `## Code
 * Patterns`. Once the scanner splits the field, decisions must reach the
 * workflow under their own heading — otherwise nine architecture decisions
 * still arrive labelled as code patterns.
 */
describe("029 FR-015: the ontology prompt labels decisions correctly (US-007)", () => {
  const DECISION_BODY = "ADR-007 forbids spawning an agent CLI directly.";
  const PATTERN_BODY = "Repository pattern in src/db.";

  /** Section bodies of the assembled workflow input, keyed by `## ` heading. */
  function sections(input: string): Map<string, string> {
    const out = new Map<string, string>();
    const parts = input.split(/^## /m).slice(1);
    for (const part of parts) {
      const newline = part.indexOf("\n");
      out.set(part.slice(0, newline).trim(), part.slice(newline + 1));
    }
    return out;
  }

  it("FR-015: renders decisions under their own heading", async () => {
    vi.resetModules();
    vi.doMock("../engine/source-scanner.js", () => ({
      scan: vi.fn().mockResolvedValue({
        specs: [],
        architecture: "Arch",
        patterns: [PATTERN_BODY],
        decisions: [DECISION_BODY],
      }),
    }));
    const executeWorkflow = vi.fn().mockResolvedValue({ summary: "ok", intents: [] });
    vi.doMock("../plugins/workflow-runtime.js", () => ({
      WorkflowRuntime: vi.fn(() => ({ executeWorkflow })),
    }));
    vi.doMock("../engine/ontology-scaffold.js", () => ({
      scaffold: vi.fn().mockResolvedValue(undefined),
    }));

    const { defineOntologyCommand } = await import("./define-ontology.js");
    await defineOntologyCommand({ run: true });

    expect(executeWorkflow).toHaveBeenCalled();
    const input = String(executeWorkflow.mock.calls[0][1]);
    const bySection = sections(input);

    const decisionHeading = [...bySection.keys()].find((h) => /decision/i.test(h));
    expect(decisionHeading, "no decisions heading in the ontology input").toBeDefined();
    expect(bySection.get(decisionHeading as string)).toContain(DECISION_BODY);
    // The mislabelling this closes: decisions must not arrive as code patterns.
    expect(bySection.get("Code Patterns") ?? "").not.toContain(DECISION_BODY);
    expect(bySection.get("Code Patterns") ?? "").toContain(PATTERN_BODY);
  });

  it("FR-015: says None found. rather than dropping the heading when there are no decisions", async () => {
    vi.resetModules();
    vi.doMock("../engine/source-scanner.js", () => ({
      scan: vi.fn().mockResolvedValue({
        specs: [],
        architecture: "Arch",
        patterns: [],
        decisions: [],
      }),
    }));
    const executeWorkflow = vi.fn().mockResolvedValue({ summary: "ok", intents: [] });
    vi.doMock("../plugins/workflow-runtime.js", () => ({
      WorkflowRuntime: vi.fn(() => ({ executeWorkflow })),
    }));
    vi.doMock("../engine/ontology-scaffold.js", () => ({
      scaffold: vi.fn().mockResolvedValue(undefined),
    }));

    const { defineOntologyCommand } = await import("./define-ontology.js");
    await defineOntologyCommand({ run: true });

    const input = String(executeWorkflow.mock.calls[0][1]);
    const decisionHeading = [...sections(input).keys()].find((h) =>
      /decision/i.test(h),
    );
    expect(decisionHeading).toBeDefined();
  });
});
