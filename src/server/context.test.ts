import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileContext } from "./context.js";

describe("compileContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-context-test-"));
    fs.mkdirSync(path.join(tempDir, ".agent/rules"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, ".agent/prompts/personas"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempDir, "specs/feature-001/.gwrk"), {
      recursive: true,
    });

    fs.writeFileSync(
      path.join(tempDir, ".agent/rules/coding-style.md"),
      "Keep it clean.",
    );
    fs.writeFileSync(
      path.join(tempDir, ".agent/prompts/personas/default.md"),
      "Be helpful.",
    );
    fs.writeFileSync(
      path.join(tempDir, "specs/feature-001/spec.md"),
      "# Spec\nDo this.",
    );
    fs.writeFileSync(
      path.join(tempDir, "specs/feature-001/plan.md"),
      "# Plan\nStep 1.",
    );
    fs.writeFileSync(
      path.join(tempDir, "specs/feature-001/.gwrk/tasks.json"),
      '{"tasks": []}',
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should compile all context sections into one markdown", () => {
    const context = compileContext(tempDir, "feature-001", "phase-01");

    expect(context).toContain("## Governance Rules");
    expect(context).toContain("coding-style.md");
    expect(context).toContain("Keep it clean.");

    expect(context).toContain("## Persona");
    expect(context).toContain("default.md");
    expect(context).toContain("Be helpful.");

    expect(context).toContain("## Feature Specification");
    expect(context).toContain("# Spec");

    expect(context).toContain("## Implementation Plan");
    expect(context).toContain("# Plan");

    expect(context).toContain("## Tasks");
    expect(context).toContain('{"tasks": []}');
  });
});
