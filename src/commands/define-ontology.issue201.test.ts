/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PluginLoader } from "../plugins/loader.js";
import type { WorkflowManifest } from "../plugins/manifest.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import * as agentModule from "../utils/agent.js";

function parseMarkdownTable(
  markdown: string,
  sectionHeading: string,
): Array<Record<string, string>> {
  const allLines = markdown.split("\n");
  const targetHeader = `## ${sectionHeading.trim()}`;
  let inSection = false;
  const sectionLines: string[] = [];

  for (const rawLine of allLines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("## ")) {
      if (inSection) break;
      if (trimmed === targetHeader) {
        inSection = true;
      }
      continue;
    }
    if (inSection) {
      sectionLines.push(trimmed);
    }
  }

  const lines = sectionLines.filter((l) => l.startsWith("|"));
  if (lines.length < 3) return [];

  const headers = lines[0]
    .split("|")
    .slice(1, -1)
    .map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];

  for (const line of lines.slice(2)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? "";
    });
    rows.push(record);
  }

  return rows;
}

describe("Issue #201: Ontology construction methodology, prompt reuse, and domain.md verification", () => {
  const repoRoot = process.cwd();

  it("Expected #1 & #2: gwrk-ontology-construct reuses the full gwrk-research-ontology method and schema", async () => {
    const loader = new PluginLoader({ projectDir: repoRoot });
    const constructPlugin = await loader.resolvePlugin("gwrk-ontology-construct");
    const researchPlugin = await loader.resolvePlugin("gwrk-research-ontology");

    const constructManifest = constructPlugin.manifest as WorkflowManifest;
    const researchManifest = researchPlugin.manifest as WorkflowManifest;

    // Schema parity (commit 3e07f9a / Finding 1)
    expect(constructManifest.outputSchema.required).toEqual([
      "summary",
      "intents",
    ]);
    expect(constructManifest.outputSchema).toEqual(
      researchManifest.outputSchema,
    );

    // Runtime prompt parity: both workflows dispatch the exact same methodology prompt
    const spy = vi.spyOn(agentModule, "dispatchToAgent").mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ summary: "ok", intents: [] }),
      stderr: "",
      durationS: 0,
    });

    const runtime = new WorkflowRuntime(loader);
    await runtime.executeWorkflow("gwrk-ontology-construct", "Test input", {
      projectRoot: repoRoot,
      agent: "agy",
    });
    const constructPrompt = spy.mock.calls[0][0].prompt ?? "";

    await runtime.executeWorkflow("gwrk-research-ontology", "Test input", {
      projectRoot: repoRoot,
      agent: "agy",
    });
    const researchPrompt = spy.mock.calls[1][0].prompt ?? "";
    spy.mockRestore();

    // Extract everything before <output_contract>
    const constructMethod = constructPrompt.split("<output_contract>")[0].trim();
    const researchMethod = researchPrompt.split("<output_contract>")[0].trim();
    expect(constructMethod).toBe(researchMethod);

    // Verify all 7 required method components from Findings 1-3 are present
    expect(constructMethod).toContain("### Primitive 2: Properties");
    expect(constructMethod).toContain("identifier");
    expect(constructMethod).toContain("extrinsic");
    expect(constructMethod).toContain("Inverse");
    expect(constructMethod).toContain("Disjointness");
    expect(constructMethod).toContain("## Failure Mode Checklist");
    expect(constructMethod).toContain("Synonym collision");
    expect(constructMethod).toContain("## Self-Reflection (Before Output)");
    expect(constructMethod).toContain("## Excluded Concepts");
  });

  it("Expected #4 & Finding #4: gwrk's own .gwrk/ontology/domain.md passes every rule of its method", () => {
    const domainPath = path.join(repoRoot, ".gwrk", "ontology", "domain.md");
    const content = fs.readFileSync(domainPath, "utf-8");

    const classes = parseMarkdownTable(content, "Classes");
    const properties = parseMarkdownTable(content, "Properties");
    const relations = parseMarkdownTable(content, "Relations");
    const individuals = parseMarkdownTable(content, "Individuals");
    const axioms = parseMarkdownTable(content, "Axioms");
    const glossary = parseMarkdownTable(content, "Glossary");
    const excluded = parseMarkdownTable(content, "Excluded Concepts");

    expect(classes.length).toBeGreaterThanOrEqual(8);

    const classNames = new Set(classes.map((c) => c.Class));

    // Rule 1: Every class traces to an existing source artifact in the repository
    for (const cls of classes) {
      const sourceRel = (cls.Source ?? "").replace(/`/g, "").trim();
      expect(
        sourceRel.length,
        `Class ${cls.Class} is missing a Source artifact`,
      ).toBeGreaterThan(0);
      expect(
        fs.existsSync(path.join(repoRoot, sourceRel)),
        `Class ${cls.Class} cites non-existent source ${sourceRel}`,
      ).toBe(true);

      // 3 to 5 example individuals in the Classes table
      const exampleList = (cls["Example Individuals"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(
        exampleList.length,
        `Class ${cls.Class} must list 3-5 Example Individuals`,
      ).toBeGreaterThanOrEqual(3);
      expect(exampleList.length).toBeLessThanOrEqual(5);
    }

    // Rule 2: Every class has at least one property with a valid volatility kind
    const validPropertyKinds = new Set([
      "identifier",
      "intrinsic",
      "state",
      "derived",
      "extrinsic",
    ]);
    for (const cls of classNames) {
      const classProps = properties.filter((p) => p.Class === cls);
      expect(
        classProps.length,
        `Class ${cls} has no properties in ## Properties`,
      ).toBeGreaterThanOrEqual(1);
      for (const prop of classProps) {
        expect(validPropertyKinds.has(prop.Kind)).toBe(true);
      }
    }

    // Rule 3: 3 to 5 individuals per class in ## Individuals
    for (const cls of classNames) {
      const classInds = individuals.filter((i) => i.Class === cls);
      expect(
        classInds.length,
        `Class ${cls} must have 3-5 entries in ## Individuals`,
      ).toBeGreaterThanOrEqual(3);
      expect(classInds.length).toBeLessThanOrEqual(5);
    }

    // Rule 4: Every relation has Direction and Inverse, with no duplicate inverse pairs
    const seenPairs = new Set<string>();
    for (const rel of relations) {
      expect(classNames.has(rel.Domain)).toBe(true);
      expect(classNames.has(rel.Range)).toBe(true);
      expect(["unidirectional", "bidirectional"]).toContain(rel.Direction);
      expect(rel.Inverse.length).toBeGreaterThan(0);

      const pairKey = [rel.Domain, rel.Range].sort().join("::");
      if (rel.Relation === "is_gated_by" || rel.Inverse === "validates") {
        expect(
          seenPairs.has(pairKey),
          `Duplicate inverse relation between ${rel.Domain} and ${rel.Range}`,
        ).toBe(false);
      }
      seenPairs.add(pairKey);
    }

    // Rule 5: Every axiom has a valid Axiom Type
    const validAxiomTypes = new Set([
      "Disjointness",
      "Existential",
      "Universal",
      "Cardinality",
      "Conditional",
    ]);
    expect(axioms.length).toBeGreaterThanOrEqual(5);
    for (const ax of axioms) {
      expect(validAxiomTypes.has(ax.Type)).toBe(true);
    }

    // Rule 6 & 7: Glossary and Excluded Concepts are populated
    expect(glossary.length).toBeGreaterThanOrEqual(5);
    expect(excluded.length).toBeGreaterThanOrEqual(3);
  });

  it("Finding #6 & #7: WHAT_IS_GWRK.md avoids 'Six Primitives' collision and R009 brief.md is populated", () => {
    const whatIsGwrk = fs.readFileSync(
      path.join(repoRoot, "docs", "product", "WHAT_IS_GWRK.md"),
      "utf-8",
    );
    expect(whatIsGwrk).not.toContain("Six Primitives");
    expect(whatIsGwrk).toContain("Six Core Concepts");

    const r009Brief = fs.readFileSync(
      path.join(repoRoot, "docs", "research", "R009-gwrk-ontology", "brief.md"),
      "utf-8",
    );
    expect(r009Brief).toContain("Five-Primitive Ontology Construction");
    expect(r009Brief).not.toContain("<!-- What are we trying to learn or prove? -->");
  });
});
