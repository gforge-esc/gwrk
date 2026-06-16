/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateGateBrief, parseGapMatrix, generateVitestGates, discoverTestFile, generateFilesystemGates } from "./gate-gen.js";
import type { GateBrief } from "./gate-gen.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("gate-gen", () => {
  function makeTempFeature(
    opts: {
      contracts?: Record<string, string>;
    } = {},
  ): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-"));
    if (opts.contracts) {
      const contractsDir = path.join(tempDir, "contracts");
      fs.mkdirSync(contractsDir, { recursive: true });
      for (const [name, content] of Object.entries(opts.contracts)) {
        fs.writeFileSync(path.join(contractsDir, name), content);
      }
    }
    return tempDir;
  }

  it("should produce valid GateBrief JSON", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Create src/utils/signal.ts",
            description: "Implement withSignal() wrapper",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: ["`pnpm build`"],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.feature).toBe("test-feature");
    expect(brief.projectType).toBe("gwrk-typescript");
    expect(brief.tasks).toHaveLength(1);
    expect(brief.tasks[0].taskId).toBe("T001");
    expect(brief.tasks[0].primaryFile).toBe("src/utils/signal.ts");
    expect(brief.tasks[0].fileType).toBe("typescript");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should classify .test.ts files as test type", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Write src/app.test.ts",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].fileType).toBe("test");
    expect(brief.tasks[0].primaryFile).toBe("src/app.test.ts");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should extract identifiers from descriptions", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement src/utils/signal.ts",
            description:
              "Add `withSignal` function and `CommandError` class. Must export `formatDuration` helper.",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].identifiers).toContain("withSignal");
    expect(brief.tasks[0].identifiers).toContain("CommandError");
    expect(brief.tasks[0].identifiers).toContain("formatDuration");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should match contract refs when contracts exist", () => {
    const tempDir = makeTempFeature({
      contracts: {
        "signal.md": "# Contract: Signal\n\nwithSignal() wrapper.",
        "output.md": "# Contract: Output\n\nCommandOutput interface.",
      },
    });
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement signal wrapper",
            description: "Per signal contract, add withSignal()",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].contractRefs).toContain("contracts/signal.md");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should include doneWhen commands relevant to the task file", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement src/utils/signal.ts",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: [
          "`grep -q 'withSignal' src/utils/signal.ts`",
          "`pnpm build`",
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].doneWhenCommands).toContain(
      "grep -q 'withSignal' src/utils/signal.ts",
    );
    // pnpm build doesn't reference signal.ts by name so it shouldn't match
    expect(brief.tasks[0].doneWhenCommands).not.toContain("pnpm build");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

// ─── Gap Matrix Tests (TR-011, TR-012, FR-012, ADR-005 §8) ──────────────────

describe("parseGapMatrix (TR-011)", () => {
  it("should parse a valid gap matrix markdown table", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-test-"));
    const matrixPath = path.join(tempDir, "gap-matrix.md");

    fs.writeFileSync(
      matrixPath,
      `# Gap Matrix

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Every gate has functional assertion | unit | gate-gen.test.ts | ✅ | T001 |
| FR-002 | define tasks calls LLM | functional | tasks-generate.test.ts | ✅ | T002 |
| FR-010 | define tests produces gap-matrix | functional | tests-generate.test.ts | ❌ | T010 |
| FR-012 | Gate generation deterministic | unit | gate-gen.test.ts | ✅ | T012 |
`,
    );

    const rows = parseGapMatrix(matrixPath);

    expect(rows).toHaveLength(4);
    expect(rows[0].ac).toBe("FR-001");
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("gate-gen.test.ts");
    expect(rows[0].testExists).toBe(true);
    expect(rows[0].gate).toBe("T001");

    expect(rows[2].ac).toBe("FR-010");
    expect(rows[2].testExists).toBe(false);
    expect(rows[2].gate).toBe("T010");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return empty array for missing file", () => {
    const rows = parseGapMatrix("/nonexistent/path/gap-matrix.md");
    expect(rows).toEqual([]);
  });

  it("should return empty array for file without table", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-test-"));
    const matrixPath = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(matrixPath, "# Gap Matrix\n\nNo table here.\n");

    const rows = parseGapMatrix(matrixPath);
    expect(rows).toEqual([]);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should handle — (dash) values as null", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-test-"));
    const matrixPath = path.join(tempDir, "gap-matrix.md");

    fs.writeFileSync(
      matrixPath,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-005 | Doc requirement | structural | — | ❌ | — |
`,
    );

    const rows = parseGapMatrix(matrixPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].testFile).toBeNull();
    expect(rows[0].gate).toBeNull();
    expect(rows[0].testType).toBe("structural");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("generateVitestGates (TR-011, FR-012)", () => {
  function makeTempFeatureWithMatrix(
    matrixContent: string,
    existingGates?: Record<string, string>,
  ): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-gates-test-"));
    fs.writeFileSync(path.join(tempDir, "gap-matrix.md"), matrixContent);
    const gatesDir = path.join(tempDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    if (existingGates) {
      for (const [name, content] of Object.entries(existingGates)) {
        fs.writeFileSync(path.join(gatesDir, name), content, { mode: 0o755 });
      }
    }
    return tempDir;
  }

  const phases = [
    {
      id: "phase-01",
      title: "Phase 1",
      tasks: [
        { id: "T001", title: "Task 1", description: "Test task", status: "open" as const, gateScript: "gates/T001-gate.sh" },
      ],
    },
  ];

  it("should generate vitest gate scripts for ✅ rows", () => {
    const tempDir = makeTempFeatureWithMatrix(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Gate assertion | unit | gate-gen.test.ts | ✅ | T001 |
| FR-012 | Deterministic gates | unit | gate-gen.test.ts | ✅ | T001 |
`,
    );

    const result = generateVitestGates(
      tempDir,
      path.join(tempDir, "gap-matrix.md"),
      phases,
    );

    expect(result.generated).toBe(2);
    expect(result.skipped).toBe(0);

    const gatePath = path.join(tempDir, "gates", "T001-gate.sh");
    expect(fs.existsSync(gatePath)).toBe(true);

    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).toContain("pnpm vitest run gate-gen.test.ts");
    expect(content).toContain("FR-001|FR-012");
    expect(content).toContain("# AUTHORED");
    expect(content).toContain("# Generated from gap-matrix.md");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should skip structural rows", () => {
    const tempDir = makeTempFeatureWithMatrix(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Gate assertion | unit | gate-gen.test.ts | ✅ | T001 |
| FR-005 | Doc exists | structural | — | ❌ | T005 |
`,
    );

    const result = generateVitestGates(
      tempDir,
      path.join(tempDir, "gap-matrix.md"),
      phases,
    );

    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);

    // T005 gate should NOT be generated (structural)
    expect(fs.existsSync(path.join(tempDir, "gates", "T005-gate.sh"))).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should skip ❌ rows (test doesn't exist yet)", () => {
    const tempDir = makeTempFeatureWithMatrix(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-010 | Gap matrix production | functional | tests-generate.test.ts | ❌ | T010 |
`,
    );

    const result = generateVitestGates(
      tempDir,
      path.join(tempDir, "gap-matrix.md"),
      phases,
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should preserve existing # AUTHORED gates", () => {
    const customContent = "#!/bin/bash\n# AUTHORED\n# My custom gate logic\npnpm vitest run custom.test.ts\n";

    const tempDir = makeTempFeatureWithMatrix(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Gate assertion | unit | gate-gen.test.ts | ✅ | T001 |
`,
      { "T001-gate.sh": customContent },
    );

    const result = generateVitestGates(
      tempDir,
      path.join(tempDir, "gap-matrix.md"),
      phases,
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);

    // Content should be unchanged
    const content = fs.readFileSync(path.join(tempDir, "gates", "T001-gate.sh"), "utf-8");
    expect(content).toBe(customContent);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should return zeros for missing gap matrix", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-gates-test-"));
    fs.mkdirSync(path.join(tempDir, "gates"), { recursive: true });

    const result = generateVitestGates(
      tempDir,
      path.join(tempDir, "gap-matrix.md"),
      phases,
    );

    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

// ─── Filesystem Gate Tests (FM-1/2/3) ────────────────────────────────────────

describe("discoverTestFile (FM-1)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should find conventional test file (foo.ts → foo.test.ts)", () => {
    const srcFile = path.join(tempDir, "foo.ts");
    const testFile = path.join(tempDir, "foo.test.ts");
    fs.writeFileSync(srcFile, "export const foo = 1;");
    fs.writeFileSync(testFile, "test('foo', () => {});");

    expect(discoverTestFile(srcFile)).toBe(testFile);
  });

  it("should return null when no test file exists", () => {
    const srcFile = path.join(tempDir, "bar.ts");
    fs.writeFileSync(srcFile, "export const bar = 1;");

    expect(discoverTestFile(srcFile)).toBeNull();
  });

  it("should return the file itself if it IS a test file", () => {
    const testFile = path.join(tempDir, "baz.test.ts");
    fs.writeFileSync(testFile, "test('baz', () => {});");

    expect(discoverTestFile(testFile)).toBe(testFile);
  });

  it("should return null for empty string", () => {
    expect(discoverTestFile("")).toBeNull();
  });
});

describe("generateFilesystemGates (FM-1/2/3)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-gates-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should generate vitest gate when test file exists", () => {
    // Create source + test files
    const srcDir = path.join(tempDir, "src", "utils");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "export const foo = 1;");
    fs.writeFileSync(path.join(srcDir, "foo.test.ts"), "test('foo', () => {});");

    // Change to tempDir so relative paths resolve
    const origCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const phases = [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            {
              id: "T001",
              title: "Implement src/utils/foo.ts",
              description: "Add foo utility",
              status: "open" as const,
              gateScript: "gates/T001-gate.sh",
            },
          ],
        },
      ];

      const result = generateFilesystemGates(tempDir, phases);

      expect(result.generated).toBe(1);
      const gatePath = path.join(tempDir, "gates", "T001-gate.sh");
      expect(fs.existsSync(gatePath)).toBe(true);

      const content = fs.readFileSync(gatePath, "utf-8");
      expect(content).toContain("pnpm vitest run");
      expect(content).toContain("src/utils/foo.test.ts");
      expect(content).toContain("# Generated from filesystem convention");
    } finally {
      process.chdir(origCwd);
    }
  });

  it("should skip gate when primary file does not exist on disk (K.TO-BE §3)", () => {
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T002",
            title: "Implement src/config.ts",
            description: "Config module (no tests)",
            status: "open" as const,
            gateScript: "gates/T002-gate.sh",
          },
        ],
      },
    ];

    const result = generateFilesystemGates(tempDir, phases);

    // K.TO-BE §3: file doesn't exist on disk → skip, don't generate bogus gate
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
    expect(fs.existsSync(path.join(tempDir, "gates", "T002-gate.sh"))).toBe(false);
  });

  it("should preserve PE-authored gates (no filesystem convention marker)", () => {
    const gatesDir = path.join(tempDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    const customContent = "#!/bin/bash\n# AUTHORED\npnpm vitest run custom.test.ts\n";
    fs.writeFileSync(path.join(gatesDir, "T003-gate.sh"), customContent);

    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T003",
            title: "Implement src/custom.ts",
            description: "Custom module",
            status: "open" as const,
            gateScript: "gates/T003-gate.sh",
          },
        ],
      },
    ];

    const result = generateFilesystemGates(tempDir, phases);

    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
    // Content must be unchanged
    const content = fs.readFileSync(path.join(gatesDir, "T003-gate.sh"), "utf-8");
    expect(content).toBe(customContent);
  });

  it("should skip tasks with no extractable file path", () => {
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T004",
            title: "Update documentation",
            description: "General docs update",
            status: "open" as const,
            gateScript: "gates/T004-gate.sh",
          },
        ],
      },
    ];

    const result = generateFilesystemGates(tempDir, phases);
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
  });
});
