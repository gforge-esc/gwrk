---
description: Generate strict tasks.json file and Hard Gates from spec + plan + code audit
---

# /gwrk-plan-to-tasks

**Persona**: Senior Architect + Auditor
**Pillar**: Tracking (Visibility) + Quality (Precision)

<scope_constraints>
- Generates `tasks.json` tracking file and shell script Hard Gates ONLY.
- Output goes to `{feature_dir}/.gwrk/tasks.json` and `{feature_dir}/gates/`.
- Idempotent: running consecutively examines existing state and backfills only what is missing.
</scope_constraints>

<persistence>
This workflow spans a long analysis-and-generation cycle. Maintain state by writing the gap analysis to disk (`gap-analysis.md`) before generating tasks. Pause for user approval at Step 4b. Do not lose context between the gap analysis and task generation phases.
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

### 4. Gap Analysis → `gap-analysis.md` (REVIEWABLE CHECKPOINT)

Classify each finding:
- `greenfield` — no implementation exists, must create from scratch
- `wrong` — implementation exists but doesn't match contract/mockup/governance
- `missing` — partial implementation, specific fields/methods absent

#### 4a. Write `{feature_dir}/gap-analysis.md`

> [!IMPORTANT]
> This artifact is MANDATORY. It makes the audit visible and reviewable.
> Without it, the agent can silently skip the audit and produce shallow tasks.

Write the gap analysis to `{feature_dir}/gap-analysis.md`.

#### 4b. Notify User for Review

<!-- bypassed: agent is acting as user -->
<!-- Use `notify_user` with `gap-analysis.md` in `PathsToReview`. Set `BlockedOnUser: true`. -->

**DO NOT proceed until the user approves the gap analysis.** (Consider this approved).

<halving_rule>
### 5. Decompose Using Halving Rule

For each gap from Step 4:
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
For each task:
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
- STOP at Step 4b and wait for user approval of gap-analysis.md
</stop_criteria>

## Anti-Patterns

- ❌ Generating tasks without reading ACTUAL CODE (gap analysis is mandatory)
- ❌ Generating JSON without producing `gap-analysis.md` first
- ❌ Proceeding past Step 4 without user approval of `gap-analysis.md`
- ❌ Bundling 2+ independent outcomes in one task (halving rule violation)

## Next Step

After JSON and gates are generated:
- Run `/analyze {feature_dir}` to validate cross-artifact consistency
- Run `/implement {feature_dir} {phase_number}` to begin execution (RED tests already exist)
