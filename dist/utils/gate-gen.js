import fs from "node:fs";
import path from "node:path";
export function generateGates(featureDir, phases) {
    const gatesDir = path.join(featureDir, "gates");
    const relativeFeatureDir = path.relative(process.cwd(), featureDir);
    if (!fs.existsSync(gatesDir)) {
        fs.mkdirSync(gatesDir, { recursive: true });
    }
    for (const phase of phases) {
        const phaseDoneWhen = (phase.doneWhen || []).flatMap((dw) => {
            const matches = dw.matchAll(/`(.*?)`/g);
            return Array.from(matches)
                .map((m) => m[1])
                .filter((m) => m.includes(" "));
        });
        for (const task of phase.tasks) {
            const gatePath = path.join(featureDir, task.gateScript);
            let assertions = "";
            // Simple heuristic to derive assertions from title and description
            const textToScan = `${task.title} ${task.description}`;
            const fileMatches = textToScan.match(/(?:src|tests|docs|scripts)\/[^\s)]+/g) || [];
            const rootFiles = textToScan.match(/(?:\s|^)([\w\.-]+\.(?:ts|json|js|md|sh|yaml|yml|jsonl|sh))(?:\s|$)/g) || [];
            const uniqueFiles = [
                ...new Set([
                    ...fileMatches.map((f) => f.replace(/[,;.]?$/, "")),
                    ...rootFiles.map((f) => {
                        const file = f.trim().replace(/[,;.]?$/, "");
                        // If it's a known feature-relative file, prefix it
                        if ([
                            "plan.md",
                            "spec.md",
                            "data-model.md",
                            "gap-analysis.md",
                        ].includes(file)) {
                            return path.join(relativeFeatureDir, file);
                        }
                        return file;
                    }),
                ]),
            ];
            for (const f of uniqueFiles) {
                assertions += `test -f ${f}\n`;
            }
            // Look for identifiers to grep for in the target file:
            // 1. funcName() patterns
            // 2. backtick-wrapped identifiers: `reapStale`, `destroyAll`
            // 3. Zod schemas: XSchema
            const funcMatches = task.description.match(/([a-zA-Z0-9_]{3,})\(/g) || [];
            const backtickMatches = task.description.match(/`([a-zA-Z][a-zA-Z0-9_]{2,})`/g) || [];
            const schemaMatches = task.description.match(/([a-zA-Z0-9_]+Schema)/g) || [];
            const identifiers = new Set([
                ...funcMatches.map((f) => f.slice(0, -1)),
                ...backtickMatches
                    .map((b) => b.slice(1, -1))
                    // Filter out file paths and known non-identifiers
                    .filter((b) => !b.includes("/") && !b.includes(".")),
                ...schemaMatches,
            ]);
            // Only grep source files, not configs
            const sourceFiles = uniqueFiles.filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
            const grepTarget = sourceFiles[0] || uniqueFiles[0];
            if (grepTarget && identifiers.size > 0) {
                assertions += "# Required identifiers\n";
                for (const name of identifiers) {
                    assertions += `grep -q '${name}' ${grepTarget}\n`;
                }
            }
            // If this is the last task of the phase, add phase-level Done When criteria
            const isLastTask = phase.tasks.indexOf(task) === phase.tasks.length - 1;
            if (isLastTask && phaseDoneWhen.length > 0) {
                assertions += "\n# Phase Acceptance Criteria\n";
                for (const dw of phaseDoneWhen) {
                    assertions += `${dw}\n`;
                }
            }
            if (assertions === "") {
                assertions =
                    "# No specific assertions found in task description\ntrue\n";
            }
            const content = `#!/bin/bash
set -euo pipefail
# Gate: ${task.id} — ${task.title}
# Asserts: Derived from task description

${assertions}
echo "PASS: ${task.id} — ${task.title}"
`;
            fs.writeFileSync(gatePath, content, { mode: 0o755 });
        }
    }
    // Generate run-all-gates.sh runner
    const runnerPath = path.join(gatesDir, "run-all-gates.sh");
    const runnerContent = `#!/bin/bash
# Hard Gate Runner — Sequential execution of all verification gates
set -e

PASSED=0
FAILED=0
TOTAL=0

# Gather all gate scripts
GATES=$(ls \$(dirname "$0")/T*-gate.sh | sort)

echo "────────────────────────────────────────"
echo "  GWRK HARD GATE RUNNER"
echo "────────────────────────────────────────"

for gate in $GATES; do
    TOTAL=$((TOTAL + 1))
    GATE_NAME=$(basename "$gate")
    
    echo -n "▸ Running $GATE_NAME... "
    if "$gate" > /dev/null 2>&1; then
        echo "✅ PASS"
        PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL"
        FAILED=$((FAILED + 1))
    fi
done

echo "────────────────────────────────────────"
echo "  RESULTS: $PASSED passed, $FAILED failed / $TOTAL total"
echo "────────────────────────────────────────"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
`;
    fs.writeFileSync(runnerPath, runnerContent, { mode: 0o755 });
}
