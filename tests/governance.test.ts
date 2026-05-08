import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("CLI Governance (Phase 11)", () => {
  const grammarDocPath = path.resolve(process.cwd(), "docs/governance/cli-grammar.md");

  it("exists: docs/governance/cli-grammar.md (US-025)", () => {
    expect(fs.existsSync(grammarDocPath), `Governance doc missing at ${grammarDocPath}`).toBe(true);
  });

  it("contains canonical grammar definition (FR-026)", () => {
    const content = fs.readFileSync(grammarDocPath, "utf-8");
    expect(content).toMatch(/# CLI Grammar Standard/i);
    expect(content).toMatch(/gwrk <verb> \[subverb\] <feature> \[phase\] \[--options\]/i);
    expect(content).toMatch(/## Command Inventory/i);
    expect(content).toMatch(/## Rules/i);
  });
});
