# Ship Pipeline Redesign: Full Cascade Fix

**Date**: 2026-05-29  
**Scope**: All 5 failure modes from the [ship failure diagnosis](file:///Users/gonzo/.gemini/antigravity/brain/58996657-e293-43da-9c22-d5396b02962d/artifacts/ship_failure_diagnosis.md)  
**References**: ADR-001 §6, ADR-005 §1–§8, ADR-007 §2.1, F004 FR-003, F014 `projectType`

---

## Why Gates Are Bash and Why That's Correct

Gates are bash scripts because gwrk manages **projects**, not just itself. [ADR-005 §2.2](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-005-tdd-gate-architecture.md) defines the `GateBrief` with `projectType: "gwrk-typescript"` — extensible via F014. Today it's vitest. Tomorrow a Python project uses pytest. A Rust project uses `cargo test`. A Go project uses `go test`. Bash is the universal execution layer that wraps any test runner without gwrk having to know or care which one the project uses.

The readVerdict/runGate pipeline ([ship-orchestrator.ts L758–808](file:///Users/gonzo/Code/gwrk/src/engine/ship-orchestrator.ts#L758-L808), [gate-runner.ts](file:///Users/gonzo/Code/gwrk/src/utils/gate-runner.ts)) calls `execFile(scriptPath)`. It doesn't know what's inside the script. That's correct — it's a verification boundary. The gate is the contract between the define pipeline ("here's what done means") and the ship pipeline ("did the agent satisfy done"). Bash is the right abstraction for that boundary.

**The problem is not the bash format. The problem is not the gate concept. The problem is how gates get authored and what feeds the authoring.**

---

## The Five Failure Modes

| FM | What Broke | Where It Broke | Root Cause |
|---|---|---|---|
| FM-1 | SIGPIPE in gates | `command \| grep -q` under `pipefail` | LLM gate author used pipe pattern instead of exit-code pattern |
| FM-2 | Hallucinated filenames | Gates referenced `define-plan.test.ts` (doesn't exist) | LLM gate author inferred filename from task description instead of filesystem |
| FM-3 | Wrong assertion patterns | Gate checked `grep -q 'new WorkflowRuntime()'` | LLM gate author guessed code pattern from task text, not actual source |
| FM-4 | `define tests` fails for MODIFY phases | Agent stubs production files, guardrail reverts ([tests-generate.ts L250–278](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts#L250-L278)) | No isolation — agent runs in the live worktree |
| FM-5 | Phase numbering mismatch | `parsePlan` uses positional index `(index + 1)` not header number ([parser.ts L49](file:///Users/gonzo/Code/gwrk/src/utils/parser.ts#L49)) | Non-sequential headers (3A, skipped numbers) break positional indexing |

**The cascade chain**:

```
FM-5 (plan numbering)
  → ship targets wrong phase content
FM-4 (define tests fails for MODIFY phases)
  → no gap-matrix.md produced
  → define tasks falls to LLM gate authoring (ADR-005 §8.3 row 2)
FM-1/FM-2/FM-3 (LLM gate quality)
  → hallucinated gates override correct agent verdicts
  → circuit break after 3 iterations
```

Both solutions must address all five.

---

## Option A: Pipeline-First (Fix Upstream, Gates Follow)

**Thesis**: The gate generation is only broken because its inputs are broken. Fix `define tests` so it works for MODIFY phases, fix the parser so phase IDs match headers, and the deterministic vitest gate generator (`generateVitestGates()`) handles everything. The LLM gate authoring path is eliminated because the deterministic path never fails to get inputs.

### FM-5 Fix: Parse Header Numbers, Not Positional Index

[parser.ts L49](file:///Users/gonzo/Code/gwrk/src/utils/parser.ts#L49) currently does:
```typescript
const phaseId = `phase-${(index + 1).toString().padStart(2, "0")}`;
```

This ignores the actual number in the header. Fix:

```typescript
// Extract the actual phase number from the header line
const headerNum = headerLine.match(/^(\d+)/)?.[1];
const phaseNum = headerNum ? parseInt(headerNum, 10) : index + 1;
const phaseId = `phase-${phaseNum.toString().padStart(2, "0")}`;
```

Now `### Phase 6: Provisioning` produces `phase-06`, not `phase-04` (when there's a 3A before it). Non-numeric headers (3A) produce `phase-03` with a suffix or get skipped — either way, the numeric phases align.

**Impact**: `gwrk ship 014 6` targets the correct phase content. Fixes the semantic mismatch where the ship agent reads the plan's Phase 6 section but operates against Phase 4's task set.

### FM-4 Fix: Worktree Isolation for `define tests`

The agent stubs production files because it needs to import functions that don't exist yet. The [guardrail](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts#L250-L278) correctly reverts these stubs. The fix isn't to weaken the guardrail — it's to give the agent a sandbox where production file modifications don't matter.

gwrk already has worktree infrastructure (F005 parallel dispatch, architecture.md §10). Use it:

```typescript
// tests-generate.ts — before dispatching the define-tests agent
const worktree = await createWorktree(projectRoot, `define-tests-${feature}`);
try {
  // Agent runs in the worktree — can stub production files freely
  const orchestrator = new DefineOrchestrator({
    featureId: feature,
    backend,
    cwd: worktree.path,  // ← isolated worktree, not live tree
  }, ...);
  
  await orchestrator.runLoop(input, { stopAfterOne: true });
  
  // Extract ONLY test artifacts from worktree into live tree
  copyTestArtifacts(worktree.path, projectRoot, feature);
  // gap-matrix.md, *.test.ts files — nothing else
  
} finally {
  await removeWorktree(worktree);
}
```

The guardrail in the live tree is now unnecessary for the worktree path (production files in the worktree can be freely modified — they're discarded). The guardrail is kept for backward compatibility with direct-mode runs.

**Impact**: `define tests` succeeds for MODIFY phases. `gap-matrix.md` is produced. `define tasks` gets its input, `generateVitestGates()` fires, LLM gate path is never reached.

### FM-1/FM-2/FM-3 Fix: Kill LLM Gate Authoring

With FM-4 fixed, the gap matrix is always produced. `generateVitestGates()` (which has [100% reliability](file:///Users/gonzo/Code/gwrk/src/utils/gate-gen.ts#L390-L535)) handles all test-backed tasks. For tasks without test coverage, the gate is an honest skip:

```bash
#!/bin/bash
# DETERMINISTIC — no test coverage in gap matrix
echo "SKIP: T009 — no test file mapped"
exit 0
```

The LLM `author-gates` workflow is deleted. `define tasks` no longer dispatches an agent for gate authoring. The `--no-llm` flag is removed (deterministic is the only mode).

ADR-005 §8.3 table becomes:

| Task has... | Gate strategy | Generator |
|---|---|---|
| Test file in gap matrix | Deterministic: `pnpm vitest run <file>` | `generateVitestGates()` |
| No test file in gap matrix | Honest skip (exit 0) | `generateVitestGates()` fallback |
| ~~No test file, has contracts~~ | ~~LLM-authored~~ | ~~`author-gates` workflow~~ **DELETED** |

### Changes

| Component | Change | FM |
|---|---|---|
| [parser.ts L49](file:///Users/gonzo/Code/gwrk/src/utils/parser.ts#L49) | Parse header number instead of positional index | FM-5 |
| [tests-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts) | Worktree isolation for agent dispatch | FM-4 |
| [gate-gen.ts](file:///Users/gonzo/Code/gwrk/src/utils/gate-gen.ts) | Remove LLM fallback path; honest skip for uncovered tasks | FM-1,2,3 |
| [tasks-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tasks-generate.ts) | Remove `dispatchAgent()` call for gate authoring | FM-1,2,3 |
| `.agents/workflows/gwrk-author-gates.md` | Delete | FM-1,2,3 |
| `readVerdict()` / `runGate()` / `gate-runner.ts` | **Unchanged** | — |
| `gates/` directory | Still generated as bash scripts, still executed | — |
| `# AUTHORED` preservation | **Unchanged** — PE hand-written gates still respected | — |

### ADR Impact

- **ADR-005 §8.3**: Remove LLM fallback row from strategy table
- **ADR-005 §2.3**: Mark LLM gate authoring as superseded by deterministic path
- **ADR-001 §6**: Unchanged — gates as bash scripts, gates as compliance mechanism
- **ADR-007**: Unchanged — `readVerdict()` still runs gates post-review

---

## Option B: Gate-Gen-First (Fix Generation, Decouple from define tests)

**Thesis**: `define tests` failing for MODIFY phases is a real bug, but fixing it requires worktree infrastructure that may not be ready. Instead, make gate generation work **without** the gap matrix by extending `generateVitestGates()` with filesystem-convention discovery. Fix the parser. Fix the SIGPIPE template. Kill LLM authoring. Leave `define tests` as a known limitation for now.

### FM-5 Fix: Same as Option A

Parse header number from plan.md instead of positional index. Identical implementation.

### FM-4: Accepted Limitation (Workaround Documented)

`define tests` still fails for MODIFY phases. The workaround is documented: author tests manually for MODIFY phases, or run `define tests` for the full feature (not phase-scoped) which is less likely to trigger the stub behavior.

The gap matrix remains optional. Gate generation works without it.

### FM-1/FM-2/FM-3 Fix: Extended Deterministic Generator

`generateVitestGates()` currently requires a gap matrix. Extend it with a **filesystem-convention fallback** that activates when no gap matrix exists:

```typescript
export function generateGates(
  featureDir: string,
  phases: Phase[],
  projectRoot: string,
): { generated: number; skipped: number } {
  const gapMatrixPath = path.join(featureDir, "gap-matrix.md");
  const gatesDir = path.join(featureDir, "gates");

  // Path 1: Gap matrix exists — use existing deterministic generator
  if (fs.existsSync(gapMatrixPath)) {
    return generateVitestGates(featureDir, gapMatrixPath, phases);
  }

  // Path 2: No gap matrix — filesystem convention discovery
  let generated = 0;
  let skipped = 0;

  for (const phase of phases) {
    for (const task of phase.tasks) {
      const gatePath = path.join(gatesDir, `${task.id}-gate.sh`);
      
      // Preserve # AUTHORED gates
      if (fs.existsSync(gatePath)) {
        const content = fs.readFileSync(gatePath, "utf-8");
        if (content.includes("# AUTHORED") && 
            !content.includes("# Generated from filesystem")) {
          skipped++;
          continue;
        }
      }

      const testFile = discoverTestFile(task, projectRoot);
      const gateContent = testFile
        ? buildVitestGate(task.id, testFile)
        : buildSkipGate(task.id);

      fs.writeFileSync(gatePath, gateContent, { mode: 0o755 });
      generated++;
    }
  }

  return { generated, skipped };
}

function discoverTestFile(task: Task, projectRoot: string): string | null {
  // Extract primary file from task title: "Implement src/commands/specify.ts"
  const text = `${task.title} ${task.description ?? ""}`;
  const rawFile = text.match(/(?:src|tests|packages)\/[^\s),]+/)?.[0];
  if (!rawFile) return null;

  const primaryFile = rawFile.replace(/[,;.]$/, "");
  
  // Convention: foo.ts → foo.test.ts
  const testFile = primaryFile.replace(/\.ts$/, ".test.ts");
  if (fs.existsSync(path.join(projectRoot, testFile))) return testFile;

  // The primary file IS a test file
  if (primaryFile.endsWith(".test.ts") && 
      fs.existsSync(path.join(projectRoot, primaryFile))) {
    return primaryFile;
  }

  return null;
}

function buildVitestGate(taskId: string, testFile: string): string {
  // SIGPIPE-safe: use vitest exit code directly, never pipe to grep
  return `#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: ${taskId}
# Generated from filesystem convention (no gap matrix)

pnpm vitest run ${testFile} --reporter=verbose \\
  || { echo "FAIL: ${taskId} — vitest failed for ${testFile}" >&2; exit 1; }

echo "PASS: ${taskId} — ${testFile}"
`;
}

function buildSkipGate(taskId: string): string {
  return `#!/bin/bash
# AUTHORED
# Gate: ${taskId}
# Generated from filesystem convention — no test file discovered
echo "SKIP: ${taskId} — no test coverage"
exit 0
`;
}
```

Key design decisions:
- **SIGPIPE-safe template** (FM-1): Uses vitest exit code directly (`||` pattern), never pipes to `grep -q`
- **Filesystem discovery** (FM-2): Uses actual files on disk, never hallucinates
- **Convention over inference** (FM-3): `foo.ts → foo.test.ts` is a mechanical transform, not LLM reasoning
- **Project-agnostic** (F014): The `buildVitestGate` function is the gwrk-typescript implementation. When F014's `projectType` extensibility ships, a Python project provides `buildPytestGate`, etc. The gate runner doesn't change.

### Changes

| Component | Change | FM |
|---|---|---|
| [parser.ts L49](file:///Users/gonzo/Code/gwrk/src/utils/parser.ts#L49) | Parse header number instead of positional index | FM-5 |
| [gate-gen.ts](file:///Users/gonzo/Code/gwrk/src/utils/gate-gen.ts) | Add filesystem-convention fallback when gap matrix missing; SIGPIPE-safe template | FM-1,2,3 |
| [tasks-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tasks-generate.ts) | Remove `dispatchAgent()` call for gate authoring; call extended `generateGates()` | FM-1,2,3 |
| `.agents/workflows/gwrk-author-gates.md` | Delete | FM-1,2,3 |
| `tests-generate.ts` | **Unchanged** (FM-4 is accepted limitation) | — |
| `readVerdict()` / `runGate()` / `gate-runner.ts` | **Unchanged** | — |
| `gates/` directory | Still generated as bash scripts, still executed | — |
| `# AUTHORED` preservation | **Unchanged** | — |

### ADR Impact

Identical to Option A: amend ADR-005 §2.3 and §8.3, no changes to ADR-001 or ADR-007.

---

## Comparison

| Dimension | Option A: Pipeline-First | Option B: Gate-Gen-First |
|---|---|---|
| **FM-1 (SIGPIPE)** | Fixed (LLM gates eliminated) | Fixed (SIGPIPE-safe template) |
| **FM-2 (Hallucination)** | Fixed (LLM gates eliminated) | Fixed (filesystem discovery) |
| **FM-3 (Assertion drift)** | Fixed (LLM gates eliminated) | Fixed (convention, not inference) |
| **FM-4 (define tests MODIFY)** | **Fixed** (worktree isolation) | Accepted limitation (workaround) |
| **FM-5 (Phase numbering)** | Fixed (parser) | Fixed (parser) |
| **Dependency** | Requires worktree infra (F005) | No new dependencies |
| **Bash gates** | Preserved | Preserved |
| **`readVerdict()`** | Unchanged | Unchanged |
| **Gap matrix** | Always produced (define tests works) | Optional (filesystem fallback) |
| **Code scope** | ~4 files + worktree integration | ~3 files, no infra dependency |
| **Risk** | Worktree isolation adds complexity | Uncovered tasks get SKIP gates (exit 0) — agent can self-certify for those tasks |

### Option A is the complete fix. It addresses every failure mode, including the root cause (`define tests` can't handle MODIFY phases). The gap matrix is always produced, which means the proven `generateVitestGates()` runs for every task.

### Option B is the pragmatic fix. It solves the immediate ship failures (FM-1/2/3/5) without requiring worktree infrastructure. FM-4 is a known limitation that only affects new `define tests` runs, not shipping existing work. It's shippable now.

---

## Reliability Baseline

| Gate source | Count | Failures | Reliability |
|---|---|---|---|
| `generateVitestGates()` — gap matrix path | 8 | 0 | **100%** |
| `generateVitestGates()` — filesystem fallback (proposed) | N/A | N/A | Expected **100%** (same logic, different input source) |
| LLM `author-gates` workflow | 5 | 5 | **0%** — deleted in both options |
| Human PE (`# AUTHORED`) | 5 | 0 | **100%** — preserved in both options |
