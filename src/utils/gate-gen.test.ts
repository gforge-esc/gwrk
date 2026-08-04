/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateGateBrief, parseGapMatrix, generateDeterministicGates, discoverTestFile, generateFilesystemGates, lintGateScript, GapMatrixHeaderError, normalizeTestType } from "./gate-gen.js";
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

describe("generateDeterministicGates (TR-011, FR-012)", () => {
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

    const result = generateDeterministicGates(
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

    const result = generateDeterministicGates(
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

    const result = generateDeterministicGates(
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

    const result = generateDeterministicGates(
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

    const result = generateDeterministicGates(
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

describe("lintGateScript (021 FR-007 — polyglot functional verbs)", () => {
  it("does not flag a pytest gate as hollow", () => {
    const gate = [
      "#!/bin/bash",
      "set -euo pipefail",
      "test -f src/foo.py || { echo FAIL >&2; exit 1; }",
      "pytest tests/foo.py -v || { echo FAIL >&2; exit 1; }",
      'echo "PASS"',
    ].join("\n");
    expect(lintGateScript(gate)).toEqual([]);
  });

  it("does not flag a `make test:auth` gate as hollow", () => {
    const gate = [
      "set -euo pipefail",
      "make test:auth || { echo FAIL >&2; exit 1; }",
      'echo "PASS"',
    ].join("\n");
    expect(lintGateScript(gate)).toEqual([]);
  });

  it("still flags a test -f-only gate as hollow (regression guard)", () => {
    const gate = ["set -euo pipefail", "test -f src/foo.py", 'echo "PASS"'].join("\n");
    expect(lintGateScript(gate)).toContain("test -f as sole assertion (hollow gate)");
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

describe("parseGapMatrix — column-name resolution (028 regression)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-cols-"));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function write(md: string): string {
    const p = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(p, md);
    return p;
  }

  // 005/007/010 shape: canonical 6 columns, Gate column empty on every row.
  // Previously: the empty cell was filtered out, leaving 5 cells, tripping
  // `cells.length < 6` — the row vanished.
  it("keeps a canonical row whose Gate cell is empty", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | some criterion | unit | tests/a.test.js | ✅ |  |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ac).toBe("FR-001");
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/a.test.js");
    expect(rows[0].testExists).toBe(true);
    expect(rows[0].gate).toBeNull();
  });

  // 009 shape: extra `Phase` column sits BETWEEN Test Exists and Gate. The
  // Phase value ("2, 3") used to be read as the gate id, producing the file
  // `2, 3-gate.sh`.
  it("does not mistake a trailing Phase column for the Gate column", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Phase | Gate |
|----|---------------------|-----------|-----------|-------------|-------|------|
| FR-008 | some criterion | unit | tests/today.test.js | ✅ | 2, 3 |  |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toBeNull();
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/today.test.js");
  });

  // 008/011 shape: extra `Phase` column sits at index 2, so the fixed-index
  // destructure read it as Test Type ("1 + 3") and failed the whitelist.
  it("does not mistake a leading Phase column for Test Type", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Phase | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-------|-----------|-----------|-------------|------|
| FR-002 | some criterion | 1 + 3 | unit | tests/b.test.js | ✅ | T002 |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].testType).toBe("unit");
    expect(rows[0].testFile).toBe("tests/b.test.js");
    expect(rows[0].gate).toBe("T002");
  });

  it("ignores rows from a foreign table of different width", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | real row | unit | tests/a.test.js | ✅ | T001 |

## RED status

| Suite | Phase | Result | Why it is RED |
|-------|-------|--------|---------------|
| ragb.test.js | 2 | # fail 1 | _lib/ragb.js absent |
`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ac).toBe("FR-001");
  });

  it("ignores a repeated header row inside the table", () => {
    const rows = parseGapMatrix(
      write(
        `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | real row | unit | tests/a.test.js | ✅ | T001 |
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
| FR-002 | after the repeat | unit | tests/b.test.js | ✅ | T002 |
`,
      ),
    );

    expect(rows.map((r) => r.ac)).toEqual(["FR-001", "FR-002"]);
  });

  it("throws GapMatrixHeaderError naming the missing column", () => {
    const p = write(
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists |
|----|---------------------|-----------|-----------|-------------|
| FR-001 | no gate column at all | unit | tests/a.test.js | ✅ |
`,
    );

    expect(() => parseGapMatrix(p)).toThrow(GapMatrixHeaderError);
    expect(() => parseGapMatrix(p)).toThrow(/Gate/);
  });

  it("still returns [] for a missing file and for a file with no table", () => {
    expect(parseGapMatrix(path.join(tempDir, "nope.md"))).toEqual([]);
    expect(parseGapMatrix(write("# Gap Matrix\n\nNo table here.\n"))).toEqual([]);
  });
});

describe("normalizeTestType (028 — compound authored vocabulary)", () => {
  it("takes the behavioral type out of a compound value", () => {
    expect(normalizeTestType("unit + gate")).toBe("unit");
    expect(normalizeTestType("gate + integration")).toBe("integration");
    expect(normalizeTestType("unit + gate + integration")).toBe("unit");
    expect(normalizeTestType("gate + unit")).toBe("unit");
  });

  it("strips markdown decoration", () => {
    expect(normalizeTestType("`[integration]`")).toBe("integration");
    expect(normalizeTestType("**unit**")).toBe("unit");
  });

  it("falls back to structural when no behavioral type is named", () => {
    expect(normalizeTestType("gate")).toBe("structural");
    expect(normalizeTestType("")).toBe("structural");
    expect(normalizeTestType("Test Type")).toBe("structural");
  });

  it("passes bare canonical values through", () => {
    for (const t of ["unit", "functional", "integration", "e2e", "structural"]) {
      expect(normalizeTestType(t)).toBe(t);
    }
  });
});

describe("parseGapMatrix — compound Test Type rows survive (028)", () => {
  it("keeps a `unit + gate` row as a unit row", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-matrix-tt-"));
    const p = path.join(tempDir, "gap-matrix.md");
    fs.writeFileSync(
      p,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | compound | unit + gate | tests/a.test.js | ✅ | T001 |
| FR-002 | gate only | gate | tests/b.test.js | ✅ | T002 |
`,
    );

    const rows = parseGapMatrix(p);
    expect(rows).toHaveLength(2);
    expect(rows[0].testType).toBe("unit");
    expect(rows[1].testType).toBe("structural");

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("generateDeterministicGates — gate id must be a task id (028)", () => {
  it("skips a gate id that no task owns and reports it", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-id-"));
    const featureDir = path.join(tempDir, "specs", "009-x");
    fs.mkdirSync(featureDir, { recursive: true });
    const matrixPath = path.join(featureDir, "gap-matrix.md");
    fs.writeFileSync(
      matrixPath,
      `| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | bogus gate id | unit | tests/a.test.js | ✅ | 2, 3 |
| FR-002 | real gate id | unit | tests/b.test.js | ✅ | T001 |
`,
    );

    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Task 1",
            description: "tests/b.test.js",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const result = generateDeterministicGates(featureDir, matrixPath, phases);

    expect(result.invalidGateIds).toContain("2, 3");
    expect(fs.existsSync(path.join(featureDir, "gates", "2, 3-gate.sh"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(featureDir, "gates", "T001-gate.sh"))).toBe(
      true,
    );

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
