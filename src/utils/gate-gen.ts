/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { Phase, Task } from "./state.js";
import type { ProjectProfile } from "../engine/prompt-conditioner.js";
import { getTestCommand, getLintCommand } from "./toolchain-mapper.js";

// ─── GateBrief interfaces (ADR-005) ──────────────────────────────────────────
// The brief is a structured manifest of what needs gating.
// projectType enables future dispatch to different gate strategies (F014).

export interface GateBrief {
  feature: string;
  projectType: "gwrk-typescript"; // extensible via F014
  tasks: TaskBrief[];
}

interface TaskBrief {
  taskId: string;
  title: string;
  description: string;
  primaryFile: string | null;
  fileType:
    | "typescript"
    | "test"
    | "shell"
    | "markdown"
    | "json"
    | "config"
    | "unknown";
  identifiers: string[];
  doneWhenCommands: string[];
  contractRefs: string[];
}

// ─── Brief generation ────────────────────────────────────────────────────────

/**
 * generateGateBrief — produce a structured JSON brief for LLM gate authoring.
 *
 * This replaces the old generateGates() (ADR-005). The brief describes what
 * each task touches (files, types, identifiers) so the LLM agent can write
 * functional assertions. The brief is context for the LLM, not production gates.
 *
 * Returns the path to the written brief JSON file.
 */
export function generateGateBrief(
  featureDir: string,
  phases: Phase[],
  feature: string,
): string {
  const relativeFeatureDir = path.relative(process.cwd(), featureDir);
  const contractsDir = path.join(featureDir, "contracts");
  const contractFiles = fs.existsSync(contractsDir)
    ? fs
        .readdirSync(contractsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join("contracts", f))
    : [];

  const tasks: TaskBrief[] = phases.flatMap((phase) => {
    const doneWhenCommands: string[] = (phase.doneWhen ?? []).flatMap((dw) =>
      [...dw.matchAll(/`([^`]+)`/g)]
        .map((m) => m[1])
        .filter(
          (m) =>
            m.includes(" ") ||
            /^(pnpm|node|gwrk|curl|grep|cat|bash|jq|gh)\b/.test(m),
        ),
    );

    return phase.tasks.map((task) =>
      buildTaskBrief(task, doneWhenCommands, relativeFeatureDir, contractFiles),
    );
  });

  const brief: GateBrief = {
    feature,
    projectType: "gwrk-typescript",
    tasks,
  };

  // Write brief into the feature's .gwrk/ directory so agent sandboxes can read it.
  // /tmp/ is inaccessible from sandboxed agents (e.g., Gemini CLI restricts to workspace).
  const gwrkDir = path.join(featureDir, ".gwrk");
  if (!fs.existsSync(gwrkDir)) {
    fs.mkdirSync(gwrkDir, { recursive: true });
  }
  const briefPath = path.join(gwrkDir, "gate-brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
  return briefPath;
}

// ─── Task brief builder ──────────────────────────────────────────────────────

function buildTaskBrief(
  task: Task,
  doneWhenCommands: string[],
  relativeFeatureDir: string,
  contractFiles: string[],
): TaskBrief {
  const text = `${task.title} ${task.description ?? ""}`;

  // Resolve primary file
  const rawFile =
    text.match(/(?:src|tests|docs|scripts|packages)\/[^\s),]+/)?.[0] ??
    text.match(/\b([\w./-]+\.(?:ts|js|sql|sh|yml|yaml|json|md))\b/)?.[0] ??
    null;
  const primaryFile = rawFile?.replace(/[,;.]$/, "") ?? null;
  const resolvedFile =
    primaryFile &&
    ["plan.md", "spec.md", "data-model.md", "gap-analysis.md"].includes(
      primaryFile,
    )
      ? path.join(relativeFeatureDir, primaryFile)
      : primaryFile;

  // Determine file type
  const fileType = resolvedFile ? classifyFileType(resolvedFile) : "unknown";

  // Extract identifiers
  const identifiers = extractIdentifiers(task.description ?? "");

  // Match done-when commands relevant to this file
  const relevantDoneWhen = resolvedFile
    ? doneWhenCommands.filter((cmd) =>
        cmd.includes(path.basename(resolvedFile)),
      )
    : [];

  // Match contracts by file path or identifier
  const contractRefs = matchContracts(text, contractFiles);

  return {
    taskId: task.id,
    title: task.title,
    description: task.description ?? "",
    primaryFile: resolvedFile,
    fileType,
    identifiers,
    doneWhenCommands: relevantDoneWhen,
    contractRefs,
  };
}

function classifyFileType(filePath: string): TaskBrief["fileType"] {
  const base = path.basename(filePath);
  const ext = path.extname(filePath);
  if (base.endsWith(".test.ts") || base.endsWith(".test.js")) return "test";
  if (ext === ".ts" || ext === ".js") return "typescript";
  if (ext === ".sh") return "shell";
  if (ext === ".md") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".yml" || ext === ".yaml") return "config";
  return "unknown";
}

function matchContracts(text: string, contractFiles: string[]): string[] {
  const textLower = text.toLowerCase();
  return contractFiles.filter((cf) => {
    const contractName = path.basename(cf, ".md").toLowerCase();
    return textLower.includes(contractName);
  });
}

// ─── Identifier extraction (preserved from original) ─────────────────────────

function extractIdentifiers(description: string): string[] {
  const funcs = [...description.matchAll(/([a-zA-Z0-9_]{3,})\(/g)].map(
    (m) => m[1],
  );
  const ticked = [...description.matchAll(/`([a-zA-Z][a-zA-Z0-9_]{2,})`/g)]
    .map((m) => m[1])
    .filter((b) => !b.includes("/") && !b.includes(".") && !b.includes(" "));
  const schemas = [
    ...description.matchAll(
      /([a-zA-Z0-9_]+(?:Schema|Config|Type|Handler|Routes?))/g,
    ),
  ].map((m) => m[1]);

  return [...new Set([...ticked, ...schemas, ...funcs])];
}

// ─── Gate runner (preserved — still needed after agent writes gates) ──────────

export function generateRunner(gatesDir: string): void {
  const runnerPath = path.join(gatesDir, "run-all-gates.sh");
  fs.writeFileSync(
    runnerPath,
    `#!/bin/bash
# Hard Gate Runner — runs all T*-gate.sh scripts sequentially
set -e

# Pre-flight: TypeScript compilation must pass before individual gates
echo "▸ pnpm build (compile gate)..."
if pnpm build > /dev/null 2>&1; then
    echo "✅ PASS"
else
    echo "❌ FAIL — pnpm build failed. Fix TypeScript errors before shipping." >&2
    exit 1
fi

PASSED=0; FAILED=0; TOTAL=0
GATES=$(ls "$(dirname "$0")"/T*-gate.sh 2>/dev/null | sort)
echo "────────────────────────────────────────"
echo "  GWRK HARD GATE RUNNER"
echo "────────────────────────────────────────"
for gate in $GATES; do
    TOTAL=$((TOTAL + 1))
    echo -n "▸ $(basename "$gate")... "
    if "$gate" > /dev/null 2>&1; then
        echo "✅ PASS"; PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL"; FAILED=$((FAILED + 1))
    fi
done
echo "────────────────────────────────────────"
echo "  $PASSED passed, $FAILED failed / $TOTAL total"
echo "────────────────────────────────────────"
[ $FAILED -eq 0 ]
`,
    { mode: 0o755 },
  );
}

// ─── Hollow Gate Linter (ADR-005) ────────────────────────────────────────────

const FUNCTIONAL_VERBS = [
  "pnpm build",
  "pnpm vitest",
  "pnpm test",
  "vitest run",
  "grep -q",
  "jq ",
  "curl ",
  "bash -n",
  "node ",
  "gwrk ",
];

/**
 * lintGateScript — detect hollow gates that violate ADR-005 gate quality rules.
 *
 * Returns an array of violation strings. Empty array = gate is valid.
 */
function lintGateScript(content: string): string[] {
  const violations: string[] = [];
  const lines = content
    .split("\n")
    .filter((l) => !l.startsWith("#") && l.trim().length > 0);

  // Filter out set -euo pipefail and echo lines (boilerplate, not assertions)
  const assertionLines = lines.filter(
    (l) => !l.trim().startsWith("set ") && !l.trim().startsWith("echo "),
  );

  if (assertionLines.length === 0) {
    violations.push("no assertions (only boilerplate)");
    return violations;
  }

  // Check: test -f as sole assertion type
  const hasTestF = assertionLines.some((l) => /\btest\s+-f\b/.test(l));
  const hasFunctionalVerb = assertionLines.some((l) =>
    FUNCTIONAL_VERBS.some((verb) => l.includes(verb)),
  );

  if (hasTestF && !hasFunctionalVerb) {
    violations.push("test -f as sole assertion (hollow gate)");
  }

  // Check: no functional assertion verbs at all
  if (!hasFunctionalVerb && !hasTestF) {
    violations.push("no functional assertions found");
  }

  return violations;
}

/**
 * lintAllGates — scan all gate scripts in a directory and return violations.
 *
 * Returns a map of gate filename → violations. Only includes gates with violations.
 */
function lintAllGates(gatesDir: string): Map<string, string[]> {
  const violations = new Map<string, string[]>();

  if (!fs.existsSync(gatesDir)) return violations;

  const gateFiles = fs
    .readdirSync(gatesDir)
    .filter((f) => /^T\d+-gate\.sh$/.test(f));

  for (const file of gateFiles) {
    const content = fs.readFileSync(path.join(gatesDir, file), "utf-8");
    const issues = lintGateScript(content);
    if (issues.length > 0) {
      violations.set(file, issues);
    }
  }

  return violations;
}

// ─── Gap Matrix types and parser (ADR-005 §8) ────────────────────────────────

interface GapMatrixRow {
  ac: string; // e.g., "FR-001"
  criterion: string; // human-readable description
  testType: "unit" | "functional" | "integration" | "e2e" | "structural";
  testFile: string | null; // relative path or null if "—"
  testExists: boolean; // ✅ = true, ❌ = false
  gate: string | null; // e.g., "T001" or null if "—"
}

/**
 * parseGapMatrix — read and parse a gap-matrix.md file.
 *
 * Parses the markdown table format defined in contracts/gap-matrix.md.
 * Returns an array of GapMatrixRow objects.
 */
export function parseGapMatrix(gapMatrixPath: string): GapMatrixRow[] {
  if (!fs.existsSync(gapMatrixPath)) {
    return [];
  }

  const content = fs.readFileSync(gapMatrixPath, "utf-8");
  const lines = content.split("\n");

  // Find the table — look for the header row with "AC" column
  const headerIdx = lines.findIndex(
    (line) => line.includes("| AC") && line.includes("Test Type"),
  );
  if (headerIdx === -1) return [];

  // Skip header and separator rows
  const dataLines = lines.slice(headerIdx + 2).filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("|") && !trimmed.startsWith("|--");
  });

  return dataLines
    .map((line) => {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 6) return null;

      const [ac, criterion, testTypeRaw, testFileRaw, testExistsRaw, gateRaw] =
        cells;

      const testType = testTypeRaw as GapMatrixRow["testType"];
      if (
        !["unit", "functional", "integration", "e2e", "structural"].includes(
          testType,
        )
      ) {
        return null;
      }

      return {
        ac: ac.trim(),
        criterion: criterion.trim(),
        testType,
        testFile:
          testFileRaw.trim() === "—" || testFileRaw.trim() === "-"
            ? null
            : testFileRaw.trim(),
        testExists: testExistsRaw.trim() === "✅",
        gate:
          gateRaw.trim() === "—" || gateRaw.trim() === "-"
            ? null
            : gateRaw.trim(),
      };
    })
    .filter((row): row is GapMatrixRow => row !== null);
}

// ─── Deterministic vitest gate generation (ADR-005 §8) ───────────────────────

/**
 * generateDeterministicGates — produce deterministic gate scripts from a gap matrix.
 *
 * For each gap matrix row where testExists is true and testType is
 * unit/functional/e2e, generates a gate script that invokes
 * the profile-driven test command (e.g. vitest, pytest).
 *
 * Respects # AUTHORED preservation — existing gates are never overwritten.
 * Returns counts of generated and skipped gates.
 */
export function generateDeterministicGates(
  featureDir: string,
  gapMatrixPath: string,
  phases: Phase[],
  profile: ProjectProfile = { type: "unknown" }
): { generated: number; skipped: number } {
  const rows = parseGapMatrix(gapMatrixPath);
  const gatesDir = path.join(featureDir, "gates");

  if (!fs.existsSync(gatesDir)) {
    fs.mkdirSync(gatesDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  // Build a map of source file → task ID from tasks.json phases.
  // This allows auto-assigning gate IDs when the gap-matrix Gate column is empty.
  const sourceFileToTaskId = new Map<string, string>();
  for (const phase of phases) {
    for (const task of phase.tasks) {
      const text = `${task.title} ${task.description ?? ""}`;
      const rawFile =
        text.match(/(?:src|tests|docs|scripts|packages)\/[^\s),]+/)?.[0] ??
        text.match(/\b([\w./-]+\.(?:ts|js|sql|sh|yml|yaml|json|md|py|go|rs))\b/)?.[0] ??
        null;
      const primaryFile = rawFile?.replace(/[,;.]$/, "") ?? null;
      if (primaryFile) {
        sourceFileToTaskId.set(primaryFile, task.id);
      }
    }
  }

  // Resolve gate IDs for rows that have no explicit Gate column.
  // Match test file (e.g., src/utils/manifest.test.ts) to source file
  // (e.g., src/utils/manifest.ts) and find the task that owns that source.
  const resolvedRows = rows.map((row) => {
    if (row.gate) return row; // Already has explicit gate ID
    if (!row.testFile || !row.testExists) return row;

    // Derive source file from test file: foo.test.ts → foo.ts
    let sourceFile = row.testFile.replace(/\.test\.(ts|js)$/, ".$1");
    sourceFile = sourceFile.replace(/_test\.go$/, ".go");
    if (path.basename(sourceFile).startsWith("test_")) {
      sourceFile = path.join(path.dirname(sourceFile), path.basename(sourceFile).replace(/^test_/, ""));
    }

    const taskId = sourceFileToTaskId.get(sourceFile);
    if (taskId) {
      return { ...row, gate: taskId };
    }

    // Fallback: try matching test file basename to any task
    const testBasename = path.basename(row.testFile).replace(/\.test\.(ts|js)$/, "").replace(/_test\.go$/, "").replace(/^test_/, "").replace(/\.(py|rs)$/, "");
    for (const [file, id] of sourceFileToTaskId) {
      if (path.basename(file).replace(/\.(ts|js|py|go|rs)$/, "") === testBasename) {
        return { ...row, gate: id };
      }
    }

    return row;
  });

  // Group rows by gate ID to combine multiple AC assertions into one gate
  const gateGroups = new Map<string, GapMatrixRow[]>();
  for (const row of resolvedRows) {
    if (!row.gate || !row.testExists || !row.testFile) {
      skipped++;
      continue;
    }
    if (row.testType === "structural") {
      skipped++;
      continue;
    }

    const existing = gateGroups.get(row.gate) ?? [];
    existing.push(row);
    gateGroups.set(row.gate, existing);
  }

  for (const [gateId, gateRows] of gateGroups) {
    const gatePath = path.join(gatesDir, `${gateId}-gate.sh`);

    // Preserve PE-authored gates (# AUTHORED without gap-matrix marker).
    // LLM-authored gates (# GENERATED) are overwritable by deterministic vitest gates.
    // Gap-matrix generated gates (# Generated from gap-matrix.md) are always regenerated.
    if (fs.existsSync(gatePath)) {
      const existingContent = fs.readFileSync(gatePath, "utf-8");
      if (
        existingContent.includes("# AUTHORED") &&
        !existingContent.includes("# Generated from gap-matrix.md")
      ) {
        skipped += gateRows.length;
        continue;
      }
    }

    // Build vitest invocations — one per unique test file
    const fileGroups = new Map<string, string[]>();
    for (const row of gateRows) {
      if (!row.testFile) continue;
      const acList = fileGroups.get(row.testFile) ?? [];
      acList.push(row.ac);
      fileGroups.set(row.testFile, acList);
    }

    // Test assertions: run appropriate test command
    const testInvocations = [...fileGroups.entries()]
      .map(([file, acs]) => {
        const grepPattern = acs.join("|");
        const cmd = getTestCommand(profile, [file], grepPattern);
        if (cmd === null) {
          // Project declares no test toolchain → honest-fail rather than emit
          // a "null" invocation (ADR-005 §11 / §10.2.5).
          return `echo "FAIL: ${gateId} — no test toolchain configured (${file})" >&2; exit 1`;
        }
        return `${cmd} \\
  || { echo "FAIL: ${gateId} — test failed for ${file}" >&2; exit 1; }`;
      })
      .join("\n\n");

    // Lint assertions: appropriate linter on source files
    const sourceFiles = [...fileGroups.keys()]
      .map((testFile) => {
        let sourceFile = testFile.replace(/\.test\.(ts|js)$/, ".$1");
        sourceFile = sourceFile.replace(/_test\.go$/, ".go");
        if (path.basename(sourceFile).startsWith("test_")) {
          sourceFile = path.join(path.dirname(sourceFile), path.basename(sourceFile).replace(/^test_/, ""));
        }
        return sourceFile;
      })
      .filter((f) => fs.existsSync(path.resolve(f)));

    const lintCmd = getLintCommand(profile, sourceFiles);
    const lintInvocations = lintCmd 
      ? `${lintCmd} \\
  || { echo "FAIL: ${gateId} — lint errors" >&2; exit 1; }`
      : "";

    const title =
      gateRows[0]?.criterion ?? `Gate ${gateId} — deterministic verification`;

    const gateContent = `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${gateId} — ${title}
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
${testInvocations}

# ── HYGIENE: Source files must lint clean ──
${lintInvocations || "# (no source files found for lint check)"}

echo "PASS: ${gateId} — tests pass + lint clean"
`;

    fs.writeFileSync(gatePath, gateContent, { mode: 0o755 });
    generated += gateRows.length;
  }

  return { generated, skipped };
}

// ─── Filesystem-convention gate generation (FM-1/2/3 fallback) ───────────────

/**
 * discoverTestFile — given a source file path, check if a conventional
 * test file exists (foo.ts → foo.test.ts).
 *
 * Returns the test file path if found, null otherwise.
 */
export function discoverTestFile(sourceFile: string): string | null {
  if (!sourceFile) return null;

  // If the file IS a test file, return it directly
  if (sourceFile.endsWith(".test.ts") || sourceFile.endsWith(".test.js")) {
    return fs.existsSync(sourceFile) ? sourceFile : null;
  }

  // Convention: foo.ts → foo.test.ts
  const testFile = sourceFile.replace(/\.(ts|js)$/, ".test.$1");
  if (fs.existsSync(testFile)) {
    return testFile;
  }

  return null;
}

/**
 * generateFilesystemGates — produce deterministic vitest gate scripts
 * from task descriptions WITHOUT requiring a gap matrix.
 *
 * For each task, extracts the primary file from the title/description,
 * checks if a corresponding .test.ts file exists, and generates a
 * vitest gate script.
 *
 * This is the fallback path when gap-matrix.md is unavailable (FM-1/2/3).
 * Respects # AUTHORED preservation — existing gates are never overwritten.
 *
 * Returns counts of generated and skipped gates.
 */
export function generateFilesystemGates(
  featureDir: string,
  phases: Phase[],
): { generated: number; skipped: number } {
  const gatesDir = path.join(featureDir, "gates");

  if (!fs.existsSync(gatesDir)) {
    fs.mkdirSync(gatesDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  for (const phase of phases) {
    // Collect test files for this phase (for the test strategy gate)
    const phaseTestFiles: string[] = [];

    for (const task of phase.tasks) {
      const gatePath = path.join(gatesDir, `${task.id}-gate.sh`);

      // Preserve PE-authored gates
      if (fs.existsSync(gatePath)) {
        const existingContent = fs.readFileSync(gatePath, "utf-8");
        if (
          existingContent.includes("# AUTHORED") &&
          !existingContent.includes("# Generated from filesystem convention")
        ) {
          skipped++;
          continue;
        }
      }

      const text = `${task.title} ${task.description ?? ""}`;

      // Skip "test strategy" meta-tasks — handled separately below
      if (text.toLowerCase().includes("test strategy")) {
        continue;
      }

      // Extract primary file from task title/description
      const rawFile =
        text.match(/(?:src|tests|docs|scripts|packages)\/[^\s),]+/)?.[0] ??
        text.match(/\b([\w./-]+\.(?:ts|js|sql|sh|yml|yaml|json|md))\b/)?.[0] ??
        null;
      const primaryFile = rawFile?.replace(/[,;.]$/, "") ?? null;

      if (!primaryFile) {
        skipped++;
        continue;
      }

      // K.TO-BE §3: Validate file exists at generation time.
      // Catches hallucinated/stale filenames from task descriptions
      // before they become gates that fail at ship time.
      if (!fs.existsSync(primaryFile)) {
        skipped++;
        continue;
      }

      // Discover corresponding test file
      const testFile = discoverTestFile(primaryFile);
      if (!testFile) {
        // No test file found — generate a file-existence gate as minimum
        const gateContent = `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${task.id} — ${task.title}
# Generated from filesystem convention (no test file found)

test -f ${primaryFile} || { echo "FAIL: ${task.id} — file not found: ${primaryFile}" >&2; exit 1; }

echo "PASS: ${task.id} — ${task.title}"
`;
        fs.writeFileSync(gatePath, gateContent, { mode: 0o755 });
        generated++;
        continue;
      }

      // Track for phase test strategy gate
      if (!phaseTestFiles.includes(testFile)) {
        phaseTestFiles.push(testFile);
      }

      const gateContent = `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${task.id} — ${task.title}
# Generated from filesystem convention (deterministic vitest gate)

test -f ${primaryFile} || { echo "FAIL: ${task.id} — file not found: ${primaryFile}" >&2; exit 1; }

pnpm vitest run ${testFile} --reporter=verbose \\
  || { echo "FAIL: ${task.id} — vitest failed for ${testFile}" >&2; exit 1; }

echo "PASS: ${task.id} — ${task.title}"
`;
      fs.writeFileSync(gatePath, gateContent, { mode: 0o755 });
      generated++;
    }

    // Generate test strategy gate (if phase has a test strategy task)
    const testStrategyTask = phase.tasks.find((t) =>
      t.title.toLowerCase().includes("test strategy"),
    );
    if (testStrategyTask && phaseTestFiles.length > 0) {
      const strategyGatePath = path.join(
        gatesDir,
        `${testStrategyTask.id}-gate.sh`,
      );

      // Preserve PE-authored gates
      if (fs.existsSync(strategyGatePath)) {
        const existingContent = fs.readFileSync(strategyGatePath, "utf-8");
        if (
          existingContent.includes("# AUTHORED") &&
          !existingContent.includes("# Generated from filesystem convention")
        ) {
          skipped++;
          continue;
        }
      }

      const testInvocations = phaseTestFiles
        .map(
          (f) =>
            `pnpm vitest run ${f} --reporter=verbose \\
  || { echo "FAIL: ${testStrategyTask.id} — ${f} failed" >&2; exit 1; }`,
        )
        .join("\n\n");

      const gateContent = `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${testStrategyTask.id} — ${testStrategyTask.title}
# Generated from filesystem convention (deterministic vitest gate)

${testInvocations}

echo "PASS: ${testStrategyTask.id} — ${testStrategyTask.title}"
`;
      fs.writeFileSync(strategyGatePath, gateContent, { mode: 0o755 });
      generated++;
    }
  }

  return { generated, skipped };
}
