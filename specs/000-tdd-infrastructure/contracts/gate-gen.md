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

Writes `run-all-gates.sh` to `gatesDir`. Called after the LLM agent writes gate scripts.

## Invariants

- Brief is written to `/tmp/gwrk-gate-brief-<timestamp>.json`
- Brief contains valid JSON parseable by `JSON.parse()`
- Every task in every phase appears exactly once in `tasks[]`
- `projectType` is always `"gwrk-typescript"` (extensible later via F014)
- `identifiers` are extracted from backtick-wrapped terms, function call patterns, and Schema/Config/Type suffixes
