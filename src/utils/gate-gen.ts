import fs from "node:fs";
import path from "node:path";
import type { Phase, Task } from "./state.js";

// ─── GateBrief interfaces (ADR-005) ──────────────────────────────────────────
// The brief is a structured manifest of what needs gating.
// projectType enables future dispatch to different gate strategies (F014).

export interface GateBrief {
  feature: string;
  projectType: "gwrk-typescript"; // extensible via F014
  tasks: TaskBrief[];
}

export interface TaskBrief {
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

  const briefPath = `/tmp/gwrk-gate-brief-${Date.now()}.json`;
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

function classifyFileType(
  filePath: string,
): TaskBrief["fileType"] {
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

// ─── Gap Matrix types and parser (ADR-005 §8) ────────────────────────────────

export interface GapMatrixRow {
  ac: string; // e.g., "FR-001"
  criterion: string; // human-readable description
  testType: "unit" | "functional" | "e2e" | "structural";
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
      if (!["unit", "functional", "e2e", "structural"].includes(testType)) {
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
 * generateVitestGates — produce deterministic gate scripts from a gap matrix.
 *
 * For each gap matrix row where testExists is true and testType is
 * unit/functional/e2e, generates a gate script that invokes
 * `pnpm vitest run <file> --grep "<AC>"`.
 *
 * Respects # AUTHORED preservation — existing gates are never overwritten.
 * Returns counts of generated and skipped gates.
 */
export function generateVitestGates(
  featureDir: string,
  gapMatrixPath: string,
  _phases: Phase[],
): { generated: number; skipped: number } {
  const rows = parseGapMatrix(gapMatrixPath);
  const gatesDir = path.join(featureDir, "gates");

  if (!fs.existsSync(gatesDir)) {
    fs.mkdirSync(gatesDir, { recursive: true });
  }

  let generated = 0;
  let skipped = 0;

  // Group rows by gate ID to combine multiple AC assertions into one gate
  const gateGroups = new Map<string, GapMatrixRow[]>();
  for (const row of rows) {
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

    // Preserve existing AUTHORED gates
    if (fs.existsSync(gatePath)) {
      const existing = fs.readFileSync(gatePath, "utf-8");
      if (existing.includes("# AUTHORED")) {
        skipped += gateRows.length;
        continue;
      }
    }

    // Build vitest invocations — one per unique test file
    const fileGroups = new Map<string, string[]>();
    for (const row of gateRows) {
      if (!row.testFile) continue;
      const existing = fileGroups.get(row.testFile) ?? [];
      existing.push(row.ac);
      fileGroups.set(row.testFile, existing);
    }

    const invocations = [...fileGroups.entries()]
      .map(([file, acs]) => {
        const grepPattern = acs.join("|");
        return `pnpm vitest run ${file} --grep "${grepPattern}" --reporter=verbose`;
      })
      .join("\n");

    const title =
      gateRows[0]?.criterion ?? `Gate ${gateId} — vitest verification`;

    const gateContent = `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${gateId} — ${title}
# Generated from gap-matrix.md (deterministic vitest gate)

${invocations}

echo "PASS: ${gateId} — vitest verification complete"
`;

    fs.writeFileSync(gatePath, gateContent, { mode: 0o755 });
    generated += gateRows.length;
  }

  return { generated, skipped };
}
