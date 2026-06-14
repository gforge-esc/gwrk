import { test, expect } from "@playwright/test";
import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as path from "node:path";

test.describe("Phase 18: Ontology Construction Workflow", () => {
  const tempDir = path.join(process.cwd(), ".test-runs/ontology-phase-18");

  test.beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  test("US-020: gwrk define ontology scaffolds project structure", async () => {
    await execa("node", ["dist/cli.js", "define", "ontology"], { cwd: tempDir });

    const domainPath = path.join(tempDir, ".gwrk/ontology/domain.md");
    const hierarchyPath = path.join(tempDir, ".gwrk/perspective/hierarchy.md");

    await expect(fs.access(domainPath)).resolves.toBeUndefined();
    await expect(fs.access(hierarchyPath)).resolves.toBeUndefined();
  });

  test("US-021: gwrk define ontology --run generates Five Primitives content", async () => {
    // Setup grounding material
    const docsDir = path.join(tempDir, "docs/grounding");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, "architecture.md"), "# Architecture\nCore concept: PluginLoader.");

    await execa("node", ["dist/cli.js", "define", "ontology", "--run"], { cwd: tempDir });

    const domainContent = await fs.readFile(path.join(tempDir, ".gwrk/ontology/domain.md"), "utf-8");

    // ADR-009 / FR-L25-012: Verify Five Primitives structure
    expect(domainContent).toContain("## Classes");
    expect(domainContent).toContain("## Properties");
    expect(domainContent).toContain("## Relations");
    expect(domainContent).toContain("## Individuals");
    expect(domainContent).toContain("## Axioms");

    // US-022: Verify grounding
    expect(domainContent.toLowerCase()).toContain("pluginloader");
  });
});
