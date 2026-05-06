# R003 — Agent Stage Containment

> **Status:** Draft — Awaiting Review
> **Initiative:** [R003 brief](file:///Users/gonzo/Code/gwrk/docs/research/R003-agent-stage-containment/brief.md)
> **Consumer:** Operating model enforcement, `tests-generate.ts` hardening, ADR-005 amendment, F014 spec (WorkflowRuntime)

---

## Executive Summary

The gwrk pipeline depends on a **separation of authorship** between pipeline stages: the agent that writes tests must not be the agent that writes implementation. This separation exists only as prose in workflow markdown files. There is zero structural enforcement. On 2026-03-19, a Gemini agent dispatched via `gwrk define tests 005-parallel-dispatch` ignored its `<scope_constraints>` and implemented all production code alongside tests. All 10 gates passed because the agent wrote both sides.

This is not a prompt engineering problem. It is an **architecture problem**: the dispatch boundary (`dispatchAgent()` in `agent.ts`) gives agents unrestricted filesystem access and performs no post-completion verification. The operating model's Test Accountability Invariant (§6), ADR-001's Maniacal Commitment Loop (§6), and the cascade's WorkflowRuntime mandate (§2.5 item 5) all describe the correct behavior — but none are enforced by code.

**Three enforcement layers are needed, each independently valuable:**

1. **Post-hoc diff guard** (detective) — After `dispatchAgent()` returns, verify that only allowed file patterns were modified. Revert and fail on violation. This is ~50 LOC, works today, and catches the exact failure that occurred.

2. **CLI-native sandbox profiles** (preventive) — Use backend-specific filesystem restrictions (Gemini `coreTools`/Seatbelt profiles, Claude permission scoping, Codex sandbox) to structurally prevent write access to disallowed paths. This is the F014 `AgentBackend` adapter's responsibility per ADR-006.

3. **WorkflowRuntime with JSON Intents** (architectural) — Per cascade §2.5 item 5, the LLM should never directly mutate the filesystem. Workflows produce structured JSON Intents; a native TypeScript runtime executes them within enforced boundaries. This is the terminal solution but requires F014 P2 (WorkflowRuntime).

**Recommendation:** Implement Layer 1 immediately (this week). Design Layer 2 as part of F014 P3 agent adapter manifests. Layer 3 is the cascade-aligned long-term architecture.

---

## Q1: Enforcement Surface

### Findings

**Current dispatch path** (`tests-generate.ts` → `dispatchAgent()` → Gemini CLI):

```
tests-generate.ts L59:
  dispatchAgent({
    backend: "gemini",
    workflowPath: ".agents/workflows/gwrk-define-tests.md",
    featureDir: "specs/005-parallel-dispatch",
  })

agent.ts buildCommand() L37-45:
  gemini -p "/gwrk-define-tests specs/005-parallel-dispatch" --approval-mode yolo

agent.ts dispatchAgent() L152-161:
  spawn(command, args, { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  → child runs in projectRoot with full filesystem access
  → on close: resolve({ exitCode, logPath })
```

**Source**: [tests-generate.ts L59-64](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts#L59-L64), [agent.ts L152-161](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts#L152-L161)

**Available enforcement points:**

| Point | When | What's Available | Enforcement Type |
|-------|------|-----------------|-----------------|
| **Pre-spawn env** | Before `spawn()` in `dispatchAgent()` | Environment variables, sandbox flags | Preventive |
| **CLI config files** | Read by CLI at startup | `.gemini/settings.json`, `.claude/settings.json` | Preventive |
| **Post-close diff** | After `child.on('close')` resolves | `git diff --name-only`, `git stash/reset` | Detective |
| **Manifest config** | At `AgentBackend.dispatch()` time (F014) | Write boundary in adapter manifest | Preventive (future) |

**Backend-specific preventive controls** (verified via web research + CLI documentation):

| Backend | Mechanism | Capability | Source |
|---------|-----------|------------|--------|
| **Gemini CLI** | `coreTools` in `.gemini/settings.json` | Whitelist specific tools (e.g., allow only `ReadFileTool`, `WriteFileTool` with restrictions) | gemini CLI docs |
| **Gemini CLI** | `excludeTools` in `.gemini/settings.json` | Blacklist specific tools or commands (e.g., `"run_shell_command(rm)"`) | gemini CLI docs |
| **Gemini CLI** | `--sandbox` + custom Seatbelt profile | macOS Seatbelt restricts filesystem writes to specific paths | `.gemini/sandbox-macos-*.sb` |
| **Claude Code** | Permission modes | `--dangerously-skip-permissions` used in yolo; can scope file writes | Claude CLI docs |
| **Codex CLI** | `--full-auto` sandbox | Sandbox restricts operations in auto mode | Codex CLI docs |

**Post-hoc git analysis** (the detective layer):

```bash
# After agent completes, before tests-generate.ts reports success:
git diff --name-only HEAD  # Files modified since last commit
git diff --cached --name-only  # Files staged
git ls-files --others --exclude-standard  # New untracked files
```

These three commands give a complete picture of what the agent touched. The `define tests` command can compare this against an allowlist and revert on violation.

### Recommendation

**Post-hoc diff guard is the highest-leverage enforcement point today.** It requires ~50 LOC in `tests-generate.ts`, works with all three backends, requires no CLI-specific configuration, and catches the exact failure that triggered this research. It is the only cross-backend mechanism that doesn't depend on F014's plugin system.

---

## Q2: Write Boundary Taxonomy

### Findings

Each pipeline stage has a distinct purpose (source: [operating-model.md §1](file:///Users/gonzo/Code/gwrk/.agents/rules/operating-model.md), [cascade.md §4](file:///Users/gonzo/Code/gwrk/docs/research/cascade.md)):

| Stage | Purpose | Allowed Write Targets | Forbidden |
|-------|---------|----------------------|-----------|
| `define spec` | Create spec from requirements | `specs/<feature>/spec.md` | Any source code, any test code |
| `define plan` | Create implementation plan | `specs/<feature>/plan.md`, `specs/<feature>/contracts/**`, `specs/<feature>/data-model.md` | Any source code, any test code |
| `define tasks` | Decompose plan into tasks + gates | `specs/<feature>/.gwrk/tasks.json`, `specs/<feature>/gates/*.sh`, `specs/<feature>/gap-analysis.md` | Any source code, any test code |
| `define tests` | Write RED tests from spec | `src/**/*.test.ts`, `src/**/*.spec.ts`, `e2e/**/*.spec.ts`, `specs/<feature>/gap-matrix.md` | **Any non-test source code** (`src/**/*.ts` excluding `*.test.ts`/`*.spec.ts`) |
| `implement` | Make tests GREEN | `src/**/*.ts` (all source), `package.json`, config files | `specs/<feature>/gates/*.sh` (ADR-005 §2.6: `# AUTHORED` preservation), other features' source |
| `review-code` | Assess implementation | `specs/<feature>/code_review.md` | Source code, test code, gates |
| `review-uat` | Acceptance testing | `specs/<feature>/uat_report.md` | Source code, test code, gates |

**The critical boundary is `define tests`:** It MUST be allowed to write `.test.ts` files but MUST NOT touch production source files. This is the exact boundary that was violated.

**Boundary representation** — a pattern-based allowlist per stage:

```typescript
interface WriteBoundary {
  stage: string;
  allowed: string[];      // glob patterns, e.g., "src/**/*.test.ts"
  forbidden: string[];    // glob patterns, e.g., "src/**/*.ts" (when not .test.ts)
  description: string;
}
```

### Recommendation

Write boundaries should be defined as a typed constant in the codebase (e.g., `src/utils/write-boundary.ts`), not as documentation. The post-hoc diff guard reads this constant to validate agent output.

---

## Q3: Enforcement Mechanisms

### Findings

**Three enforcement layers, each with distinct properties:**

#### Layer 1: Post-Dispatch Diff Guard (Detective)

**How it works:** After `dispatchAgent()` resolves, before the command reports success:

```typescript
// In tests-generate.ts, after dispatchAgent() returns:
const changedFiles = execSync('git diff --name-only HEAD', { encoding: 'utf-8' })
  .trim().split('\n').filter(Boolean);
const newFiles = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8' })
  .trim().split('\n').filter(Boolean);
const allTouched = [...changedFiles, ...newFiles];

const violations = allTouched.filter(f => !matchesAllowlist(f, WRITE_BOUNDARIES['define-tests']));

if (violations.length > 0) {
  // Revert all changes
  execSync('git checkout -- .', { cwd: projectRoot });
  execSync('git clean -fd', { cwd: projectRoot });
  console.error(`Stage containment violation: define-tests touched forbidden files:`);
  violations.forEach(f => console.error(`  ${f}`));
  process.exitCode = 1;
  return;
}
```

| Property | Assessment |
|----------|-----------|
| Reliability | **High** — git diff is deterministic. If the agent touched forbidden files, we catch it. |
| Complexity | **~50 LOC** — a single function + write boundary constant |
| CLI compatibility | **All 3 backends** — backend-agnostic, works at the git layer |
| F005 alignment | **Compatible** — works in both host worktree and sandbox worktree |
| F014 alignment | **Compatible** — can be generalized into `AgentBackend` post-dispatch hook |
| Reversibility | **Trivial** — remove the check |
| Limitation | **Reactive, not preventive** — the agent wastes tokens doing forbidden work before we revert it |

#### Layer 2: CLI-Native Sandbox Profiles (Preventive)

**How it works:** The agent adapter configures its CLI to restrict filesystem access before dispatch.

**Gemini example** — custom Seatbelt profile for `define-tests`:

```lisp
;; .gemini/sandbox-macos-define-tests.sb
(version 1)
(deny default)
(allow file-read*)
(allow file-write*
  (regex #"\.test\.ts$")
  (regex #"\.spec\.ts$")
  (regex #"/gap-matrix\.md$")
)
```

**Dispatch with sandbox profile:**
```bash
gemini -p "/gwrk-define-tests specs/005-parallel-dispatch" \
  --sandbox --sandbox-profile define-tests \
  --approval-mode yolo
```

| Property | Assessment |
|----------|-----------|
| Reliability | **High for Gemini** (macOS Seatbelt is kernel-enforced). **Medium for Claude/Codex** (permission modes are application-level). |
| Complexity | **Medium** — per-backend, per-stage profile files. ~5 profiles × 3 backends = 15 config files. |
| CLI compatibility | **Backend-specific** — each backend has different restriction mechanisms. This is the adapter's job in F014. |
| F005 alignment | **Compatible** — sandbox profiles work in worktrees |
| F014 alignment | **Natural fit** — `AgentBackend.dispatch()` can include sandbox config. The adapter's manifest declares supported restriction modes. |
| Reversibility | **Easy** — remove profile files |
| Limitation | **Backend-coupled** — Gemini Seatbelt is kernel-enforced (strong); Claude/Codex restrictions are app-level (weaker). |

#### Layer 3: WorkflowRuntime with JSON Intents (Architectural)

**How it works:** Per cascade §2.5 item 5 and R002 Q7, the LLM does NOT write files directly. Instead:

1. The workflow defines a JSON Schema output contract (what files to create, what content)
2. The LLM produces structured JSON Intents (file paths, content, operation type)
3. `WorkflowRuntime` (native TypeScript) validates intents against write boundaries
4. `WorkflowRuntime` applies validated intents to the filesystem

```typescript
// Future: WorkflowRuntime validates intents
interface FileIntent {
  operation: 'create' | 'modify' | 'delete';
  path: string;
  content?: string;
}

function executeIntents(intents: FileIntent[], boundary: WriteBoundary): void {
  for (const intent of intents) {
    if (!matchesBoundary(intent.path, boundary)) {
      throw new ContainmentViolation(intent.path, boundary.stage);
    }
    applyIntent(intent);
  }
}
```

| Property | Assessment |
|----------|-----------|
| Reliability | **Highest** — violations are structurally impossible. The LLM cannot touch the filesystem; only validated intents can. |
| Complexity | **High** — requires WorkflowRuntime (F014 P2), JSON Schema output contracts per workflow, migration of all `define` workflows |
| CLI compatibility | **Backend-agnostic** — the LLM produces structured output; the runtime does I/O |
| F005 alignment | **Compatible** — intents execute in the sandbox context |
| F014 alignment | **This IS the F014 design** — cascade §2.5 item 5, R002 Q6/Q7 |
| Reversibility | **Low** — fundamental architecture change |
| Limitation | **Not available today** — requires F014 P2 (WorkflowRuntime), which depends on F014 P1 (Plugin Loader) |

### Recommendation

**Layer 1 immediately, Layer 2 at F014 P3, Layer 3 at F014 P2.** Each layer is independently valuable and composes with the others (defense in depth). Layer 1 is the only one that can ship this week. Layer 2 becomes possible when agent adapters own their CLI config. Layer 3 is the terminal architecture that eliminates the category of bug entirely.

---

## Q4: Gate Hardening

### Findings

**The gate failure mode is NOT weak gates — it's collapsed pipeline stages.**

ADR-005 §1 correctly identifies grep-only gates as weak:
> "An agent can create a file containing the string 'foo' without implementing anything. The gate passes. Truth is corrupted."

ADR-005 §8 (Triad Model) addresses this by introducing deterministic vitest gates that run actual tests. Gates T002, T005, T007, T010 in the 005-parallel-dispatch set DO run vitest — they are structurally correct gates. The problem is that the SAME agent wrote both the tests and the implementation, so of course vitest passes.

**The real gate gap is the "RED check":**

ADR-001 §6 (Maniacal Commitment Loop) specifies:

```
1. gwrk tasks next → Returns next unblocked task
2. gates/T0xx-gate.sh → Must FAIL (verify state is RED)    ← THIS STEP
3. Execute Implementation
4. gates/T0xx-gate.sh → Must PASS (verify state is GREEN)
5. gwrk tasks done → Finalize state + commit
```

Step 2 is the RED check. It verifies that the gate FAILS before implementation begins. If the gate already passes (because a rogue agent implemented during `define tests`), the RED check catches it.

**But `gwrk gate` doesn't distinguish RED from GREEN checks.** The `gate.ts` command expects gates to PASS. There is no `gwrk gate --expect-red` mode that verifies gates FAIL.

**Design for RED/GREEN gate enforcement:**

```typescript
// gate.ts enhancement
.option('--expect <state>', 'Expected gate outcome: "red" (must fail) or "green" (must pass)')

// When --expect red:
// Gate passes → VIOLATION (should be failing)
// Gate fails → CORRECT (tests are red, no implementation yet)
```

The `define tests` command should run `gwrk gate --expect red` after generating tests. If any gate passes, the tests are hollow (ADR-005 §8.3 red_validation_rules).

**Authorship provenance:**

There is no cryptographic way to prove test authorship differs from implementation authorship today. However, git commit metadata provides a weaker signal:

- `define tests` commits with message `test: red tests for Phase N`
- `implement` commits with message `feat: Phase N implementation`
- Different runs have different `runId` in the execution ledger (ADR-002)

This isn't cryptographic proof, but a post-hoc audit (`gwrk gate --expect red` against the commit BEFORE `implement` ran) can verify the RED→GREEN transition happened.

### Recommendation

1. Add `--expect red` flag to `gwrk gate` — inverts pass/fail semantics
2. `define tests` MUST run `gwrk gate --expect red` before reporting success
3. If any gate passes during `--expect red`, the tests are hollow — fail the `define tests` command
4. This enforces ADR-001 §6 step 2 systematically

---

## Q5: Cascade Impact

### Findings

| Document | Required Amendment | Severity |
|----------|-------------------|----------|
| **Operating model §6** | Add: "Enforcement MUST be structural (code), not advisory (prompts). Write boundaries are enforced by `dispatchAgent()` post-hoc verification." | HIGH — the invariant exists but has no teeth |
| **ADR-005** | New section §9: Write Boundary Enforcement. Define the diff guard mechanism. Reference write boundary taxonomy. | HIGH — ADR-005 is the gate architecture ADR |
| **ADR-006** | Amend §2.1: `AgentBackend.dispatch()` should accept a `WriteBoundary` parameter. The adapter uses it to configure CLI-native sandbox profiles. | MEDIUM — design for F014 P3 |
| **cascade.md §4** | Add enforcement checkpoint: After each `define tests`, run `gwrk gate --expect red`. | HIGH — pipeline enforcement |
| **`gwrk-define-tests.md`** | Add Step 7b (post-generation): `gwrk gate --expect red`. If any gate passes, revise tests. | HIGH — workflow enforcement |
| **`tests-generate.ts`** | Add diff guard after `dispatchAgent()`. Add `gwrk gate --expect red` invocation. | HIGH — code enforcement |
| **F014 spec** | Add FR for `WriteBoundary` in `AgentBackend` interface. Add FR for WorkflowRuntime file intent validation. | MEDIUM — future enforcement |
| **New ADR?** | **No new ADR needed.** This is an amendment to ADR-005 (gate architecture) and ADR-006 (plugin dispatch). The containment mechanism flows from existing decisions. | — |

**Implementation order does NOT change.** The cascade §5 order remains: F014 P1-P2 → F011 → F005 → F014 P3. The diff guard is a small change to `tests-generate.ts` that can ship before any feature work.

---

## Output Contract Deliverables

### 1. Enforcement Mechanism Comparison Matrix

| Criterion | Layer 1: Diff Guard | Layer 2: CLI Sandbox | Layer 3: WorkflowRuntime |
|-----------|:---:|:---:|:---:|
| **Reliability** | ⭐⭐⭐⭐ (deterministic git) | ⭐⭐⭐ (varies by backend) | ⭐⭐⭐⭐⭐ (structural impossibility) |
| **Complexity** | ⭐⭐⭐⭐⭐ (~50 LOC) | ⭐⭐⭐ (~15 config files) | ⭐⭐ (F014 P2 dependency) |
| **CLI compat (all 3)** | ⭐⭐⭐⭐⭐ (git-layer) | ⭐⭐⭐ (backend-specific) | ⭐⭐⭐⭐⭐ (backend-agnostic) |
| **F005 alignment** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **F014 alignment** | ⭐⭐⭐⭐ (generalizable) | ⭐⭐⭐⭐⭐ (adapter's job) | ⭐⭐⭐⭐⭐ (IS the architecture) |
| **Reversibility** | ⭐⭐⭐⭐⭐ (trivial) | ⭐⭐⭐⭐ (easy) | ⭐⭐ (fundamental) |
| **Ships when** | **This week** | F014 P3 | F014 P2 |
| **Catches incident** | ✅ Yes | ✅ Prevents it | ✅ Eliminates category |

### 2. Write Boundary Specification

See Q2 write boundary taxonomy table above.

### 3. Recommended Containment Architecture

**Defense in depth — three layers, each independently valuable:**

```
Layer 1 (detective):   dispatchAgent() → agent runs → diff guard checks → revert on violation
Layer 2 (preventive):  AgentBackend configures CLI sandbox before dispatch → agent cannot touch forbidden files
Layer 3 (structural):  LLM produces JSON Intents → WorkflowRuntime validates & executes → no direct filesystem access
```

**Each layer catches failures the others might miss:**
- Layer 1 catches rogue agents that bypass CLI sandbox restrictions
- Layer 2 prevents the agent from wasting tokens on forbidden work
- Layer 3 eliminates the category — there is no filesystem access to restrict

### 4. Gate Hardening Design

See Q4 findings. Summary:
- Add `--expect red` to `gwrk gate`
- `define tests` invokes `gwrk gate --expect red` before reporting success
- If gates pass when they should be RED → tests are hollow → fail the command

### 5. ADR/Spec Amendment List

See Q5 cascade impact table.

### 6. Implementation Sketch

**Immediate: Diff Guard (~50 LOC)**

File: `src/utils/write-boundary.ts` (NEW, ~30 LOC)
```typescript
export interface WriteBoundary {
  stage: string;
  allowed: string[];   // minimatch patterns
  forbidden: string[]; // minimatch patterns
}

export const BOUNDARIES: Record<string, WriteBoundary> = {
  'define-tests': {
    stage: 'define-tests',
    allowed: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'e2e/**/*.spec.ts', 'specs/**/gap-matrix.md'],
    forbidden: ['src/**/*.ts'],  // caught AFTER allowed patterns match
  },
  'define-spec': { ... },
  'define-plan': { ... },
};

export function checkBoundary(files: string[], boundary: WriteBoundary): string[] { ... }
```

File: `src/commands/tests-generate.ts` (MODIFY, ~20 LOC after `dispatchAgent()`)
```typescript
// After dispatchAgent() returns successfully:
const touched = getAllTouchedFiles(projectRoot);
const violations = checkBoundary(touched, BOUNDARIES['define-tests']);
if (violations.length > 0) {
  revertAll(projectRoot);
  fail('define tests', 1, durationS, runId);
  console.error(`Containment violation: ${violations.join(', ')}`);
  process.exitCode = 1;
  return;
}
```

**Next: `--expect red` for `gwrk gate` (~30 LOC)**

File: `src/commands/gate.ts` (MODIFY)
- Add `--expect <state>` option
- When `--expect red`: invert pass/fail semantics (gate passes → violation)

**Total immediate work: ~80 LOC, no new dependencies.**

### 7. Architecture Stress Test

#### Pass 1 — Analytical (Decompose)

| Component | Depends On | Produces | Blast Radius If Missing |
|-----------|-----------|----------|------------------------|
| Write boundary taxonomy | Operating model, ADR-005 | Typed pattern constants | All enforcement layers fail — no definition of "violation" |
| Diff guard (L1) | Write boundaries, git | Post-dispatch compliance check | Agents can freely violate stage mandates (current state) |
| CLI sandbox profiles (L2) | F014 adapter manifests, CLI docs | Per-stage filesystem restrictions | Agents waste tokens on forbidden work before L1 catches them |
| WorkflowRuntime (L3) | F014 P1 (loader), P2 (runtime) | Structural containment | N/A — L1+L2 provide coverage until L3 ships |
| `--expect red` gate | gate.ts, gate scripts | RED state verification | Hollow tests pass undetected |

**Critical path:** Write boundaries → Diff guard → `--expect red`. All three ship independently. No dependency on F014.

#### Pass 2 — Pre-mortem (This Failed — Why?)

1. **The diff guard has a race condition.** (Likelihood: LOW) If the agent commits its own changes before `dispatchAgent()` returns, `git diff --name-only HEAD` shows nothing. **Mitigation:** Check against the commit SHA captured BEFORE dispatch, not `HEAD`. `const preDispatchSha = execSync('git rev-parse HEAD').trim(); ... git diff --name-only ${preDispatchSha}`.

2. **Gemini Seatbelt profile is macOS-only.** (Likelihood: MEDIUM) On Linux CI or Docker, Seatbelt doesn't exist. **Mitigation:** L2 is backend-specific by design — each adapter provides its platform's enforcement. L1 (diff guard) is platform-independent and always runs.

3. **Write boundary patterns are too coarse.** (Likelihood: MEDIUM) A glob like `src/**/*.test.ts` might allow an agent to create a `.test.ts` file that is actually production code in disguise. **Mitigation:** The diff guard checks PATTERNS, not CONTENT. Content verification is the gate's job (`--expect red`). If the "test" file actually implements behavior, the RED check will catch it (the gate will pass when it should fail).

4. **WorkflowRuntime (L3) never ships.** (Likelihood: LOW) F014 P2 is in the cascade. **Mitigation:** L1+L2 provide indefinite coverage. L3 is desirable but not required for safety.

5. **Agent creates files outside the allowlist in a temp directory, then moves them.** (Likelihood: LOW) `git diff` catches the final state, not the process. If files end up in forbidden paths, the guard catches them regardless of how they got there.

#### Pass 3 — Comparative (Alternatives)

| Alternative | Speed | Risk | Complexity | Why Not Primary |
|-------------|-------|------|-----------|----------------|
| **"Stronger prompts" only** | ⭐⭐⭐⭐⭐ | ⭐ (LLMs are non-deterministic) | ⭐⭐⭐⭐⭐ | Anti-pattern per brief. Prompts are guidance, not enforcement. |
| **Separate git repos per stage** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | Massive overhead. Requires cloning + syncing per dispatch. |
| **Docker containers per stage** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | Requires Docker. Conflicts with gwrk's local-first mandate. |
| **Diff guard (L1) + RED check** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | **Selected.** Immediate, cross-platform, composable with L2/L3. |
| **Full WorkflowRuntime (L3) now** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | Requires F014 P1+P2. Months of work. L1+L2 provide coverage. |

**Verdict: APPROVE the L1 → L2 → L3 layered approach.** The diff guard + RED check ships immediately and catches the exact failure. CLI sandbox profiles harden further at F014 P3. WorkflowRuntime eliminates the category at F014 P2. No single layer is a silver bullet; defense in depth is correct.

---

## Spec Alignment Notes

- **ADR-005 §9 (NEW):** Write Boundary Enforcement — diff guard mechanism, write boundary taxonomy, `--expect red` semantics
- **ADR-006 §2.1 amendment:** `AgentBackend.dispatch()` accepts optional `WriteBoundary` parameter for CLI-native sandbox configuration
- **Cascade §4:** Insert enforcement checkpoint after each `define tests` step
- **F014 spec:** Add FR for `WriteBoundary` in `AgentBackend` interface; add FR for WorkflowRuntime intent validation

## Architecture Amendments

### Operating model §6 — Enforcement addendum

```diff
 ## 6. Test Accountability Invariant
 *   The agent that writes code MUST NOT be the sole judge of whether its verification is adequate.
 *   All verification gates MUST exist as committed artifacts BEFORE implementation begins.
 *   `/review-code` verdicts MUST be based on pre-committed gate results, not agent self-reports.
 *   Gate files (`gates/*.sh`) are contracts — the implementing agent MUST NOT edit or delete them.
+*   Write boundaries MUST be enforced structurally by `dispatchAgent()`, not advisory by workflow prompts.
+*   `define tests` MUST verify `gwrk gate --expect red` before reporting success.
```

## Open Items

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Write boundary for `define spec` and `define plan` — are these enforced today? | Requires Decision | Not critical (spec/plan agents don't typically write source code), but completeness demands it |
| 2 | Should the diff guard run for ALL dispatch stages or only `define tests`? | Requires Decision | Recommendation: all stages. The write boundary taxonomy already covers them. Cost is one `git diff` per dispatch. |
| 3 | Does the pre-dispatch SHA snapshot need to be persisted for audit? | Requires Decision | Useful for the execution ledger (ADR-002) but not required for enforcement |

---

## Source Lineage

| Source | Contribution |
|--------|-------------|
| [operating-model.md §6](file:///Users/gonzo/Code/gwrk/.agents/rules/operating-model.md) | Test Accountability Invariant — the constitutional principle violated |
| [ADR-001 §6](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md) | Maniacal Commitment Loop — RED→IMPLEMENT→GREEN→DONE |
| [ADR-005 §1, §8](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-005-tdd-gate-architecture.md) | Grep gate weakness, Triad Model, pipeline reorder |
| [ADR-006 §2.1, §2.5](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md) | AgentBackend dispatch contract, config isolation |
| [cascade.md §2.5, §4](file:///Users/gonzo/Code/gwrk/docs/research/cascade.md) | WorkflowRuntime mandate, define pipeline order |
| [R002 brief Q6/Q7](file:///Users/gonzo/Code/gwrk/docs/research/R002-agent-backend-plugin/brief.md) | WorkflowRuntime, filesystem decoupling |
| [tests-generate.ts](file:///Users/gonzo/Code/gwrk/src/commands/tests-generate.ts) | Current dispatch path (no enforcement) |
| [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts) | `dispatchAgent()` implementation |
| [gwrk-define-tests.md](file:///Users/gonzo/Code/gwrk/.agents/workflows/gwrk-define-tests.md) | Workflow with violated scope constraints |
| [Agent log](file:///Users/gonzo/Code/gwrk/.runs/2026-03-19T18-44-42_gwrk-define-tests_005-parallel-dispatch.log) | Evidence of containment violation |
| [Gemini CLI sandbox docs](https://geminicli.com) | `coreTools`, `excludeTools`, Seatbelt profiles |
| [parallel-dispatch-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/parallel-dispatch-architecture.md) | Sandbox isolation model, hexagonal dispatch |
