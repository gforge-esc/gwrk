---
description: Generate strict tasks.json file and Hard Gates from spec + plan + code audit
---

# /plan-to-tasks

**Persona**: Senior Architect + Auditor
**Pillar**: Tracking (Visibility) + Quality (Precision)

<scope_constraints>
- Generates `tasks.json` tracking file and shell script Hard Gates ONLY.
- Output goes to `{feature_dir}/.gwrk/tasks.json` and `{feature_dir}/gates/`.
- Idempotent: running consecutively examines existing state and backfills only what is missing.
</scope_constraints>

<persistence>
This workflow spans a long analysis-and-generation cycle. If `gap-matrix.md` exists (produced by `define tests`), use it as the authoritative coverage audit. If it doesn't exist, produce a `gap-analysis.md` as a supplementary audit. Do not lose context between the analysis and task generation phases.
</persistence>

## Purpose

Analyzes spec, plan, contracts, mockups, AND actual implemented code to generate
the `tasks.json` tracking file and, crucially, the `gates/T0xx-gate.sh` files that ensure 
execution adherence.

> **Core principle**: The AI's value is in *decomposition, gap analysis, and
> description quality* — producing tasks with zero interpretation required.
> Each task must be so precise that a dev agent can apply the diff and verify
> the result without asking a single question. The Hard Gate is the enforcer.

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)

## Prerequisites

- `{feature_dir}/spec.md` exists
- `{feature_dir}/plan.md` exists

## Steps

### 1. Load Context (Deep Read)

Read and understand the feature deeply:
- `{feature_dir}/spec.md` — user stories, requirements, priorities
- `{feature_dir}/plan.md` — phases, file structure, Governance & Skills Contract, type dependency graph
- `{feature_dir}/data-model.md` — if exists
- `{feature_dir}/contracts/` — MANDATORY. Method-level contracts define task boundaries.
- `.agent/rules/` — read each governance rule referenced in plan.md's Governance & Skills Contract

### 2. Examine Existing State (Idempotency)

Before generating tasks, check what already exists:

```bash
cat {feature_dir}/.gwrk/tasks.json
```

If the JSON file exists, parse its current structure.
- **Backfill mode**: Only generate tasks/gates for missing phases/tasks.

### 3. Read Actual Code (THE CRITICAL STEP)

For every file listed in `plan.md`:

1. **If the file exists** → read it completely. Note which contract methods/types are implemented.
2. **If the file doesn't exist** → note it as `greenfield`
3. **For existing files, compare against contracts/** field by field: Does the implementation match?

### 4. Gap Analysis (REVIEWABLE CHECKPOINT)

**Check for gap matrix first:**
```bash
test -f {feature_dir}/gap-matrix.md && echo "Gap matrix exists — using as authoritative audit"
```

#### Path A: Gap Matrix Exists (produced by `define tests`)

If `gap-matrix.md` exists, it IS the gap analysis. Read it and use it to inform task decomposition in Step 5. The gap matrix maps every FR/US/TR/SC to a test type, test file, and existence status.

Skip writing `gap-analysis.md` — the gap matrix supersedes it.

#### Path B: No Gap Matrix (backward compatibility)

Classify each finding from Step 3:
- `greenfield` — no implementation exists, must create from scratch
- `wrong` — implementation exists but doesn't match contract/mockup/governance
- `missing` — partial implementation, specific fields/methods absent

Write the gap analysis to `{feature_dir}/gap-analysis.md`.

> [!NOTE]
> The preferred workflow is to run `gwrk define tests` first (which produces `gap-matrix.md`),
> then run `gwrk define tasks`. This avoids duplicating the code audit.

<halving_rule>
### 5. Decompose Using Halving Rule

For each gap from Step 4 (either gap matrix rows or gap analysis findings):
1. Define the smallest independently-verifiable unit of work
2. **Apply halving**: "Does this task contain 2+ independent verifiable outcomes?"
   - If yes → split into separate tasks
   - If no → it's one task
</halving_rule>

### 6. Generate `tasks.json`

Write/update the `{feature_dir}/.gwrk/tasks.json` file. 
Structure:
```json
{
  "feature": "001-cli-core",
  "phases": [
    {
      "id": "1",
      "name": "Phase 1: Bootstrapping",
      "tasks": [
        {
          "id": "T001",
          "title": "Create CLI entrypoint",
          "description": "Initialize src/cli.ts with Commander.js",
          "status": "open" // open, completed
        }
      ]
    }
  ]
}
```

### 7. Emit Verification Gates (Hard Gate Architecture)

For each task in the JSON, generate `{feature_dir}/gates/{task_id}-gate.sh`.
Gates MUST exit 0 on pass, non-zero on fail. Also generate `gates/run-all-gates.sh` that runs all `T*-gate.sh` scripts in order and reports pass/fail counts.

> [!CAUTION]
> **Gates MUST be generated FROM contracts, not from task description prose.**
> Weak gates that only check file existence cause infinite implement→review loops.

<gate_generation_rules>

#### Path A: Gap Matrix Exists (ADR-005 §8)

If `gap-matrix.md` exists, generate **deterministic vitest gates** for all tasks backed by test files:

1. For each gap matrix row where `Test Exists: ✅` and `Test Type` is `unit`/`functional`/`e2e`:
   - Gate script = `pnpm vitest run <Test File> --grep "<AC>" --reporter=verbose`
   - Mark with `# AUTHORED` and `# Generated from gap-matrix.md (deterministic vitest gate)`
2. For remaining tasks (no test coverage in matrix): fall through to Path B below
3. **Generate `gates/run-all-gates.sh`** — runner for all gate scripts

#### Path B: Contract-Based Gates (LLM Fallback)

For each task NOT covered by Path A:
1. Identify the contract method(s) it implements.
2. Generate a `grep -q` or `jq -e` assertion against the implementation file.
3. Assert the EXACT type signature, not just that a function exists.
4. For each `## Files to Modify` entry:
   - Assert the **Target state** is present (not just that the file exists)
5. **Number every assertion sequentially** with a comment `# Assertion #1`, `# Assertion #2`, etc.
   This is MANDATORY so `/review-code` can reference SPECIFIC failures in its GATE field:
   `gates/T012-gate.sh assertion #3`
6. **Generate `gates/run-all-gates.sh`** — a runner that executes all `T*-gate.sh` scripts
   in order and reports pass/fail counts. `/review-code` Step 5 depends on this file existing.
</gate_generation_rules>

### 8. Make Gates Executable

// turbo
```bash
chmod +x {feature_dir}/gates/*.sh
```

### 9. Report

Notify user with the hierarchy summary.

<stop_criteria>
- If no gap matrix exists: STOP at Step 4 and wait for user approval of gap-analysis.md
- If gap matrix exists: proceed directly to Step 5 (no user checkpoint needed)
</stop_criteria>

## Anti-Patterns

- ❌ Generating tasks without reading ACTUAL CODE (code audit is mandatory)
- ❌ Generating tasks without gap matrix or gap analysis (audit is mandatory)
- ❌ Bundling 2+ independent outcomes in one task (halving rule violation)
- ❌ Writing gates with only `test -f` assertions when tests exist in the gap matrix

## Next Step

After JSON and gates are generated:
- Run `/analyze {feature_dir}` to validate cross-artifact consistency
- Run `/define-tests {feature_dir} {phase_number}` to generate RED tests (if not already done)
- Run `/implement {feature_dir} {phase_number}` to begin execution
