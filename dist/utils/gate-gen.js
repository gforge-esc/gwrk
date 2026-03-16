import fs from "node:fs";
import path from "node:path";
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
export function generateGateBrief(featureDir, phases, feature) {
    const relativeFeatureDir = path.relative(process.cwd(), featureDir);
    const contractsDir = path.join(featureDir, "contracts");
    const contractFiles = fs.existsSync(contractsDir)
        ? fs
            .readdirSync(contractsDir)
            .filter((f) => f.endsWith(".md"))
            .map((f) => path.join("contracts", f))
        : [];
    const tasks = phases.flatMap((phase) => {
        const doneWhenCommands = (phase.doneWhen ?? []).flatMap((dw) => [...dw.matchAll(/`([^`]+)`/g)]
            .map((m) => m[1])
            .filter((m) => m.includes(" ") ||
            /^(pnpm|node|gwrk|curl|grep|cat|bash|jq|gh)\b/.test(m)));
        return phase.tasks.map((task) => buildTaskBrief(task, doneWhenCommands, relativeFeatureDir, contractFiles));
    });
    const brief = {
        feature,
        projectType: "gwrk-typescript",
        tasks,
    };
    const briefPath = `/tmp/gwrk-gate-brief-${Date.now()}.json`;
    fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));
    return briefPath;
}
// ─── Task brief builder ──────────────────────────────────────────────────────
function buildTaskBrief(task, doneWhenCommands, relativeFeatureDir, contractFiles) {
    const text = `${task.title} ${task.description ?? ""}`;
    // Resolve primary file
    const rawFile = text.match(/(?:src|tests|docs|scripts|packages)\/[^\s),]+/)?.[0] ??
        text.match(/\b([\w./-]+\.(?:ts|js|sql|sh|yml|yaml|json|md))\b/)?.[0] ??
        null;
    const primaryFile = rawFile?.replace(/[,;.]$/, "") ?? null;
    const resolvedFile = primaryFile &&
        ["plan.md", "spec.md", "data-model.md", "gap-analysis.md"].includes(primaryFile)
        ? path.join(relativeFeatureDir, primaryFile)
        : primaryFile;
    // Determine file type
    const fileType = resolvedFile ? classifyFileType(resolvedFile) : "unknown";
    // Extract identifiers
    const identifiers = extractIdentifiers(task.description ?? "");
    // Match done-when commands relevant to this file
    const relevantDoneWhen = resolvedFile
        ? doneWhenCommands.filter((cmd) => cmd.includes(path.basename(resolvedFile)))
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
function classifyFileType(filePath) {
    const base = path.basename(filePath);
    const ext = path.extname(filePath);
    if (base.endsWith(".test.ts") || base.endsWith(".test.js"))
        return "test";
    if (ext === ".ts" || ext === ".js")
        return "typescript";
    if (ext === ".sh")
        return "shell";
    if (ext === ".md")
        return "markdown";
    if (ext === ".json")
        return "json";
    if (ext === ".yml" || ext === ".yaml")
        return "config";
    return "unknown";
}
function matchContracts(text, contractFiles) {
    const textLower = text.toLowerCase();
    return contractFiles.filter((cf) => {
        const contractName = path.basename(cf, ".md").toLowerCase();
        return textLower.includes(contractName);
    });
}
// ─── Identifier extraction (preserved from original) ─────────────────────────
function extractIdentifiers(description) {
    const funcs = [...description.matchAll(/([a-zA-Z0-9_]{3,})\(/g)].map((m) => m[1]);
    const ticked = [...description.matchAll(/`([a-zA-Z][a-zA-Z0-9_]{2,})`/g)]
        .map((m) => m[1])
        .filter((b) => !b.includes("/") && !b.includes(".") && !b.includes(" "));
    const schemas = [
        ...description.matchAll(/([a-zA-Z0-9_]+(?:Schema|Config|Type|Handler|Routes?))/g),
    ].map((m) => m[1]);
    return [...new Set([...ticked, ...schemas, ...funcs])];
}
// ─── Gate runner (preserved — still needed after agent writes gates) ──────────
export function generateRunner(gatesDir) {
    const runnerPath = path.join(gatesDir, "run-all-gates.sh");
    fs.writeFileSync(runnerPath, `#!/bin/bash
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
`, { mode: 0o755 });
}
