---
description: Cross-artifact consistency analysis (read-only).
---

# /gwrk-analyze

**Persona**: Principal Engineer
**Pillar**: Definition (Quality Gate)

<scope_constraints>
- This workflow is STRICTLY READ-ONLY. Do not modify any files.
- Output a structured analysis report only.
- Do not fix issues. Document them for the spec author.
- Limit findings to 50 items to avoid overwhelming.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)

## Prerequisites

- `{feature_dir}/spec.md` exists.
- `{feature_dir}/plan.md` exists.
- `{feature_dir}/.gwrk/tasks.json` exists (tasks.json is the tracking source of truth).

## Steps

### 1. Load Artifacts

Read all available definition artifacts:

| Artifact | Purpose | Required |
|----------|---------|----------|
| `spec.md` | Requirements, user stories, TRs | ✅ |
| `plan.md` | Architecture, phases, file changes | ✅ |
| `.gwrk/tasks.json` | Task tracking (phases, tasks, statuses) | ✅ |
| `gates/*.sh` | Verification gate scripts (if present) | Optional |
| `data-model.md` | Domain entities | Optional |
| `contracts/` | Zod schemas, API contracts | Optional |
| `checklists/` | Quality gate checklists | Optional |

### 2. Load Task State

Read the current tracking state from `tasks.json`:

```bash
cat {feature_dir}/.gwrk/tasks.json | jq '.phases[] | {name, tasks: [.tasks[] | {id, title, status}]}'
```

### 3. Run Detection Passes

#### A. Structural Consistency

- **Duplication**: Near-duplicate requirements across spec sections
- **Ambiguity**: Vague terms (fast, scalable, robust, appropriate)
- **Coverage**: Requirements in spec.md with no corresponding task in tasks.json
- **Orphan Tasks**: Tasks in tasks.json with no traceable requirement in spec.md
- **Schema Match**: Entities in spec vs domain types

#### B. TDD Quality (CRITICAL)

This is the highest-weight detection pass. Every task must be test-drivable:

- **TR Section**: Does spec.md contain Testing Requirements (TR-###)?
  - E2E tests (Playwright) for user-facing flows?
  - Docker verification (`make up`) for handoff?
  - Unit tests for business logic?
  - If TR section missing: **CRITICAL** gap.

- **Per-Task Test Gates**: For each task in tasks.json:
  - Does the task description include verifiable ACCEPTANCE criteria?
  - Are acceptance criteria specific and measurable (not prose)?
    - ❌ BAD: "Sidebar looks correct"
    - ✅ GOOD: "Sidebar width >= 32ch; background-color matches --background1"
  - Does the task reference PLAYWRIGHT assertions where applicable?
  - Are test file paths specified?

- **TDD Readiness Score**: For each phase, count tasks with vs without
  test-gate definitions → report as `{N}/{TOTAL} tasks have test gates`.
  Score < 80%: **CRITICAL** gap.

#### C. Gate Script Quality (if `{feature_dir}/gates/` exists)

When `/plan-to-tasks` has already generated gate scripts, analyze their quality:

- **Assertion Strength**: Read each gate script:
  - Does it assert EXACT type signatures (not just file existence)?
  - Does it use `grep -q` or `jq -e` against implementation files?
  - Gates that only check `[ -f file ]`: **HIGH** finding.

- **Contract Derivation**: Are gates derived from `contracts/`, not task prose?
  - Gates that paraphrase task descriptions instead of testing contracts: **HIGH** finding.

- **Assertion Numbering**: Are assertions numbered sequentially (#1, #2, ...)?
  - Unnumbered assertions make `/review-code` GATE field references impossible: **MEDIUM** finding.

- **Coverage**: Does every task in tasks.json have a corresponding gate script?
  - Missing gate for a task: **MEDIUM** finding.

- **Runner**: Does `gates/run-all-gates.sh` exist?
  - Missing runner: **MEDIUM** finding.

#### D. State Synchronization (frontend specs)

- Are optimistic ID → server ID reconciliation patterns specified?
- Are React component identity (`key` prop) requirements defined?

#### E. Seed Data Integrity (specs with fixtures)

- Do fixtures use valid UUIDs (not placeholder strings)?
- Is Zod schema validation required for seed data?

#### F. Governance Alignment

Reference applicable governance rules from `.gwrk/rules/`:
- Config hygiene if config/env changes
- Seeding governance if fixture changes

<severity_criteria>
| Level | Criteria |
|-------|----------|
| **CRITICAL** | Missing core artifact, zero coverage, missing TR/E2E requirements, TDD score < 80% |
| **HIGH** | Orphan tasks, conflicting requirements, task without acceptance criteria, gate without contract-derived assertions |
| **MEDIUM** | Terminology drift, missing gate runner, thin description |
| **LOW** | Style improvements, naming suggestions |
</severity_criteria>

### 5. Output Analysis Report

Report via notify_user (do NOT write files):

```markdown
## Analysis Report: {feature_name}

### TDD Readiness
| Phase | Tasks with test gates | Score | Verdict |
|-------|----------------------|-------|---------| 
| Phase N | M/T | XX% | ✅/❌ |

### Gate Script Quality (if applicable)
| Gate | Contract-derived | Assertion strength | Numbered | Verdict |
|------|-----------------|-------------------|----------|---------|
| T0XX-gate.sh | ✅/❌ | strong/weak | ✅/❌ | ✅/❌ |

### Findings
| ID | Category | Severity | Location | Issue | Recommendation |
|----|----------|----------|----------|-------|----------------|

### Final Verdict
Verdict: [READY or NOT READY]
```

<quality_gate>
- **READY**: No CRITICAL findings. TDD readiness >= 80%.
  You MUST output exactly `Verdict: READY` on its own line at the end of the report.
  → Ready for `/implement`.
- **NOT READY**: CRITICAL findings or TDD < 80%.
  You MUST output exactly `Verdict: NOT READY` on its own line at the end of the report.
  → Fix issues, then re-run `/analyze`.
</quality_gate>

<stop_criteria>
- STOP at 50 findings maximum — prioritize by severity
- STOP if no spec.md or plan.md exists (prerequisites not met)
- Do NOT modify any files — this workflow is strictly read-only
- Do NOT fix issues — document them and report
</stop_criteria>

## Anti-Patterns

- ❌ Reference `tasks.md` or `phases/*.md` as source of truth (tasks.json is truth)
- ❌ Modify any files (this is read-only analysis)
- ❌ Accept vague acceptance criteria ("looks correct", "works properly")
- ❌ Skip gate script review when gates exist
- ❌ Report >50 findings (prioritize by severity)

## Next Step

After analysis:
- If NOT READY: Iterate on spec/plan/gates, then re-run `/analyze`
- If READY: Run `/implement {feature_dir} {phase_number}`
