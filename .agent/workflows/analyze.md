---
description: Cross-artifact consistency analysis (read-only).
---

# /analyze

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
- `{feature_dir}/.beads-id` exists (beads is the tracking source of truth).

## Steps

### 1. Load Artifacts

Read all available definition artifacts:

| Artifact | Purpose | Required |
|----------|---------|----------|
| `spec.md` | Requirements, user stories, TRs | ✅ |
| `plan.md` | Architecture, phases, file changes | ✅ |
| `.beads-id` | Tracking IDs (feature + phase mappings) | ✅ |
| `beads/*.sh` | Task import scripts (if present) | Optional |
| `data-model.md` | Domain entities | Optional |
| `contracts/` | Zod schemas, API contracts | Optional |
| `checklists/` | Quality gate checklists | Optional |

> **Note**: `tasks.md` and `phases/*.md` are DEPRECATED artifacts. If found,
> flag their existence as an inconsistency — beads is the source of truth.

### 2. Load Beads State

If tasks are already imported into beads, examine live state:

```bash
FEATURE_ID=$(jq -r '.feature' {feature_dir}/.beads-id)
bd children $FEATURE_ID --json 2>&1

# For each phase, get tasks
for phase_id in $(bd children $FEATURE_ID --json | jq -r '.[].id'); do
  bd children $phase_id --json 2>&1
done
```

### 3. Run Detection Passes

#### A. Structural Consistency

- **Duplication**: Near-duplicate requirements across spec sections
- **Ambiguity**: Vague terms (fast, scalable, robust, appropriate)
- **Coverage**: Requirements in spec.md with no corresponding task in beads
- **Orphan Tasks**: Tasks in beads with no traceable requirement in spec.md
- **Schema Match**: Entities in spec vs domain types
- **Deprecated Artifacts**: `tasks.md` or `phases/` files exist alongside beads

#### B. TDD Quality (CRITICAL)

This is the highest-weight detection pass. Every task must be test-drivable:

- **TR Section**: Does spec.md contain Testing Requirements (TR-###)?
  - E2E tests (Playwright) for user-facing flows?
  - Docker verification (`make up`) for handoff?
  - Unit tests for business logic?
  - If TR section missing: **CRITICAL** gap.

- **Per-Task Test Gates**: For each task in beads (or beads scripts):
  - Does the task description include verifiable ACCEPTANCE criteria?
  - Are acceptance criteria specific and measurable (not prose)?
    - ❌ BAD: "Sidebar looks correct"
    - ✅ GOOD: "Sidebar width >= 32ch; background-color matches --background1"
  - Does the task reference PLAYWRIGHT assertions where applicable?
  - Are test file paths specified?

- **TDD Readiness Score**: For each phase, count tasks with vs without
  test-gate definitions → report as `{N}/{TOTAL} tasks have test gates`.
  Score < 80%: **CRITICAL** gap.

#### C. Beads Script Quality (if `{feature_dir}/beads/` exists)

When `/plan-to-beads` has already generated scripts, analyze their quality:

- **Idempotency**: Do all scripts guard with existence checks?
  - Pattern: `if echo "$EXISTING" | grep -q "T0XX"; then ... skip ... fi`
  - Scripts that blindly `bd create` without checking: **HIGH** finding.

- **Description Density**: Read each task body (heredoc in scripts):
  - Does it specify FILES to modify/create?
  - Does it include ACCEPTANCE criteria?
  - Does it include PLAYWRIGHT or test assertions?
  - Does it reference spec requirements (FR-###, TR-###)?
  - Tasks with <3 lines of description: **HIGH** finding.

- **Numbering Gaps**: Does task numbering follow the convention?
  - T0XX = Phase 0, T01X = Phase 1, T02X = Phase 2, etc.
  - Naming collisions across scripts: **HIGH** finding.

- **Dependency Wiring**: Does the dependency wiring script exist?
  - Does it wire cross-phase deps?
  - Does it wire TDD deps (impl tasks → test task)?
  - Missing dependency wiring: **MEDIUM** finding.

- **Import Runner**: Does `import-all.sh` exist?
  - Does it auto-commit after import?
  - Missing runner: **MEDIUM** finding.

#### D. State Synchronization (frontend specs)

- Are optimistic ID → server ID reconciliation patterns specified?
- Are React component identity (`key` prop) requirements defined?

#### E. Seed Data Integrity (specs with fixtures)

- Do fixtures use valid UUIDs (not placeholder strings)?
- Is Zod schema validation required for seed data?

#### F. Governance Alignment

Reference applicable governance rules from `.agent/rules/`:
- Config hygiene if config/env changes
- Seeding governance if fixture changes

<severity_criteria>
| Level | Criteria |
|-------|----------|
| **CRITICAL** | Missing core artifact, zero coverage, missing TR/E2E requirements, TDD score < 80% |
| **HIGH** | Orphan tasks, conflicting requirements, task without acceptance criteria, script without idempotency |
| **MEDIUM** | Terminology drift, missing dependency wiring, thin description |
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

### Beads Script Quality (if applicable)
| Script | Idempotent | Descriptions | Test Gates | Verdict |
|--------|-----------|--------------|------------|---------| 
| 01-phase-N-tasks.sh | ✅/❌ | N/T dense | M/T have tests | ✅/❌ |

### Findings
| ID | Category | Severity | Location | Issue | Recommendation |
|----|----------|----------|----------|-------|----------------|
```

<quality_gate>
- **READY**: No CRITICAL findings. TDD readiness >= 80%.
  → Ready for `/implement`.
- **NOT READY**: CRITICAL findings or TDD < 80%.
  → Fix issues, then re-run `/analyze`.
</quality_gate>

<stop_criteria>
- STOP at 50 findings maximum — prioritize by severity
- STOP if no spec.md or plan.md exists (prerequisites not met)
- Do NOT modify any files — this workflow is strictly read-only
- Do NOT fix issues — document them and report
</stop_criteria>

## Anti-Patterns

- ❌ Reference `tasks.md` as source of truth (beads → scripts → bd are truth)
- ❌ Modify any files (this is read-only analysis)
- ❌ Accept vague acceptance criteria ("looks correct", "works properly")
- ❌ Skip beads script review when scripts exist
- ❌ Report >50 findings (prioritize by severity)

## Next Step

After analysis:
- If NOT READY: Iterate on spec/plan/scripts, then re-run `/analyze`
- If READY: Run `/implement {feature_dir} {phase_number}`
