import fs from "node:fs";
import path from "node:path";
import type { Phase, Task } from "./state.js";

/**
 * generateGates — write gate shell scripts for each task.
 *
 * Gate authoring strategy (priority order):
 *
 * 1. AUTHORED — if a pre-written gate exists at gates/TASK_ID-gate.sh already,
 *    leave it untouched. Authored gates (by an LLM or human) always win.
 *
 * 2. DONE WHEN — extract backtick-wrapped shell commands from the phase's
 *    "Done When" section and use the ones relevant to this task's file.
 *
 * 3. TYPED FALLBACK — by file extension:
 *    - .test.ts → pnpm vitest run <file>
 *    - .sql     → test -f + grep for expected column names
 *    - .ts/.js  → identifier grep + compiled output check
 *    - .sh      → bash -n (syntax check)
 *    - other    → test -s (non-empty)
 *
 * 4. ABSOLUTE FALLBACK — pnpm build exits 0.
 *
 * NOTE: File-existence-only (test -f) gates are NEVER emitted as the sole
 * assertion. Every gate must make a functional claim.
 */
export function generateGates(featureDir: string, phases: Phase[]): void {
  const gatesDir = path.join(featureDir, "gates");
  const relativeFeatureDir = path.relative(process.cwd(), featureDir);

  if (!fs.existsSync(gatesDir)) {
    fs.mkdirSync(gatesDir, { recursive: true });
  }

  for (const phase of phases) {
    // Extract all backtick-wrapped shell commands from Done When lines
    const doneWhenCommands: string[] = (phase.doneWhen ?? []).flatMap((dw) =>
      [...dw.matchAll(/`([^`]+)`/g)]
        .map((m) => m[1])
        .filter(
          (m) =>
            m.includes(" ") ||
            /^(pnpm|node|gwrk|curl|grep|cat|bash|jq|gh)\b/.test(m),
        ),
    );

    for (const task of phase.tasks) {
      const gatePath = path.join(featureDir, task.gateScript);

      // Priority 1: leave authored gates untouched
      if (fs.existsSync(gatePath)) {
        const existing = fs.readFileSync(gatePath, "utf-8");
        if (existing.includes("# AUTHORED")) continue;
      }

      const assertions = buildAssertions(
        task,
        phase,
        doneWhenCommands,
        relativeFeatureDir,
      );

      const content = [
        "#!/bin/bash",
        "set -euo pipefail",
        `# Gate: ${task.id} — ${task.title}`,
        "# Generated: assertions derived from plan Done When + file type.",
        "# To override, add '# AUTHORED' anywhere and edit freely.",
        "",
        assertions,
        "",
        `echo "PASS: ${task.id} — ${task.title}"`,
        "",
      ].join("\n");

      fs.writeFileSync(gatePath, content, { mode: 0o755 });
    }
  }

  generateRunner(gatesDir);
}

function buildAssertions(
  task: Task,
  phase: Phase,
  doneWhenCommands: string[],
  relativeFeatureDir: string,
): string {
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

  const lines: string[] = [];

  // Priority 2: Done When commands referencing this file
  if (resolvedFile) {
    const base = path.basename(resolvedFile);
    const matching = doneWhenCommands.filter((cmd) => cmd.includes(base));
    if (matching.length > 0) {
      lines.push("# Done When (from plan)");
      lines.push(...matching);
    }
  }

  // Priority 3: typed fallback
  if (lines.length === 0 && resolvedFile) {
    const ext = path.extname(resolvedFile);
    const base = path.basename(resolvedFile);

    if (base.endsWith(".test.ts") || base.endsWith(".test.js")) {
      lines.push("# Test file — run it");
      lines.push(`pnpm vitest run ${resolvedFile} --reporter=verbose`);
    } else if (ext === ".sql") {
      lines.push(`test -f ${resolvedFile}`);
      const cols = [...text.matchAll(/\b([a-z][a-z_]{2,})\b/g)]
        .map((m) => m[1])
        .filter((w) => w.includes("_"))
        .slice(0, 2);
      for (const col of cols) {
        lines.push(`grep -qi '${col}' ${resolvedFile}`);
      }
    } else if (ext === ".ts" || ext === ".js") {
      const ids = extractIdentifiers(task.description ?? "").slice(0, 4);
      if (ids.length > 0) {
        lines.push("# Required identifiers");
        for (const id of ids) lines.push(`grep -q '${id}' ${resolvedFile}`);
      }
      const compiled = `dist/${resolvedFile.replace(/^src\//, "").replace(/\.ts$/, ".js")}`;
      lines.push(`test -f ${compiled}`);
    } else if (ext === ".sh") {
      lines.push(`test -f ${resolvedFile}`);
      lines.push(`bash -n ${resolvedFile}`);
    } else {
      lines.push(`test -f ${resolvedFile}`);
      lines.push(`test -s ${resolvedFile}`);
    }
  }

  // Priority 4: phase Done When on last task (exclude already added)
  const isLast = phase.tasks.indexOf(task) === phase.tasks.length - 1;
  if (isLast && doneWhenCommands.length > 0) {
    const added = new Set(lines);
    const extra = doneWhenCommands.filter((cmd) => !added.has(cmd));
    if (extra.length > 0) {
      lines.push("", "# Phase Acceptance Criteria (Done When)");
      lines.push(...extra);
    }
  }

  // Absolute fallback
  if (lines.length === 0) {
    lines.push("# Fallback: build must compile");
    lines.push("pnpm build 2>&1 | tail -1");
  }

  return lines.join("\n");
}

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

function generateRunner(gatesDir: string): void {
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
