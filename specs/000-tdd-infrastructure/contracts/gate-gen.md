# Contract: Gate Brief Generation — `generateGateBrief()`

**Source**: `src/utils/gate-gen.ts`
**Spec**: FR-002, ADR-005

## Method

```typescript
export function generateGateBrief(
  featureDir: string,
  phases: Phase[],
  feature: string,
): string;
```

Returns absolute path to the written brief JSON file (in `/tmp/`).

## Schema

```typescript
interface GateBrief {
  feature: string;
  projectType: "gwrk-typescript";  // extensible via F014
  tasks: TaskBrief[];
}

interface TaskBrief {
  taskId: string;           // e.g., "T001"
  title: string;            // from plan task title
  description: string;      // from plan task description
  primaryFile: string | null;  // resolved file path
  fileType: "typescript" | "test" | "shell" | "markdown" | "json" | "config" | "unknown";
  identifiers: string[];    // extracted function/class/export names
  doneWhenCommands: string[];  // backtick-wrapped commands from phase doneWhen
  contractRefs: string[];   // matched contract file paths from contracts/
}
```

## Behavior

| Input | Output |
|---|---|
| Valid phases with tasks | JSON file with one `TaskBrief` per task across all phases |
| Task with no file reference | `primaryFile: null`, `fileType: "unknown"` |
| Task with `.test.ts` file | `fileType: "test"` |
| Feature with `contracts/` | `contractRefs` populated by name matching |
| Feature without `contracts/` | `contractRefs: []` for all tasks |

## File Type Classification

| Extension | `fileType` |
|---|---|
| `*.test.ts`, `*.test.js` | `test` |
| `*.ts`, `*.js` | `typescript` |
| `*.sh` | `shell` |
| `*.md` | `markdown` |
| `*.json` | `json` |
| `*.yml`, `*.yaml` | `config` |
| Everything else | `unknown` |

## Gate Runner

```typescript
export function generateRunner(gatesDir: string): void;
```

Writes `run-all-gates.sh` to `gatesDir`. Called after gates are generated (either deterministic or LLM-authored).

## Deterministic Vitest Gate Generation (ADR-005 §8)

```typescript
export function generateVitestGates(
  featureDir: string,
  gapMatrixPath: string,
  phases: Phase[],
): { generated: number; skipped: number };
```

Reads `gap-matrix.md`, parses the markdown table, and generates deterministic gate scripts for all rows where:
- `Test Exists: ✅`
- `Test Type` is `unit`, `functional`, or `e2e`
- `Gate` column maps to a task ID

### Behavior

| Input | Output |
|---|---|
| Gap matrix with 7 rows, 5 with ✅ tests | 5 gate scripts generated, 2 skipped |
| Gap matrix with `Test Type: structural` | Skipped (no vitest gate for structural assertions) |
| Existing `# AUTHORED` gate for same task | Skipped (preservation rule §2.6) |
| No gap matrix file | Returns `{ generated: 0, skipped: 0 }` — caller falls through to LLM |

### Generated Gate Format

```bash
#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — <task title>
# Generated from gap-matrix.md (deterministic vitest gate)

pnpm vitest run <test_file> --grep "<AC_ID>" --reporter=verbose

echo "PASS: T001 — <task title>"
```

### Invariants

- Generated gates always contain `pnpm vitest run` — no `test -f` or `grep -q` only
- Generated gates always have `# AUTHORED` marker (line 2)
- Existing `# AUTHORED` gates are never overwritten
- Returns counts so caller can determine if LLM fallback is needed
- Gate file naming: `{featureDir}/gates/{taskId}-gate.sh`

## Invariants (Shared)

- Brief is written to `/tmp/gwrk-gate-brief-<timestamp>.json`
- Brief contains valid JSON parseable by `JSON.parse()`
- Every task in every phase appears exactly once in `tasks[]`
- `projectType` is always `"gwrk-typescript"` (extensible later via F014)
- `identifiers` are extracted from backtick-wrapped terms, function call patterns, and Schema/Config/Type suffixes
