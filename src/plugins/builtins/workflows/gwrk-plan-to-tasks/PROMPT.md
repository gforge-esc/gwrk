# /gwrk-plan-to-tasks

**Persona**: Senior Architect + Auditor
**Pillar**: Tracking (Visibility) + Quality (Precision)

<scope_constraints>
- Generates `tasks.json` tracking file and shell script Hard Gates ONLY.
[type: gwrk-native]
- Output goes to `{feature_dir}/.gwrk/tasks.json` and `{feature_dir}/gates/`.
[/type]
[type: generic]
- Output goes to the feature directory's task and gate locations.
[/type]
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
[type: gwrk-native]
- `.gwrk/rules/` — read each governance rule referenced in plan.md's Governance & Skills Contract
[/type]
[type: generic]
- Project rules and governance documents.
[/type]

### 2. Examine Existing State (Idempotency)

Before generating tasks, check what already exists:

[type: gwrk-native]
```bash
cat {feature_dir}/.gwrk/tasks.json
```
[/type]
[type: generic]
Check for existing task tracking files in the project.
[/type]

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

[type: gwrk-native]
Write/update the `{feature_dir}/.gwrk/tasks.json` file.
[/type]
[type: generic]
Write/update the project's task tracking file.
[/type]

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
[type: gwrk-native]
          "description": "Initialize src/cli.ts with Commander.js. Tests: src/cli.test.ts",
[/type]
[type: generic]
          "description": "Detailed description of the task requirements and target files.",
[/type]
          "status": "open"
        }
      ]
    }
  ]
}
```

> [!IMPORTANT]
[type: gwrk-native]
> The `description` field MUST include the absolute path to the `.test.ts` files (e.g., `Tests: src/cli.test.ts`). This is structurally MANDATORY because the execution runner uses regex on the description field to locate the tests for each task.
[/type]
[type: generic]
> The `description` field should include references to any relevant test files or documentation to aid the implementing agent.
[/type]

### 7. Gate Generation (Deterministic — DO NOT author gates manually)

> [!CAUTION]
> **DO NOT write gate scripts.** Gate generation is handled deterministically
> by the CLI after this workflow completes. The agent's only responsibility
> is producing high-quality `tasks.json` with precise task descriptions.

Gate scripts are generated by one of two paths:

[type: gwrk-native]
1. **Gap-matrix path** (preferred): If `{feature_dir}/gap-matrix.md` exists,
   `generateVitestGates()` reads the matrix and produces targeted vitest gates.
2. **Filesystem-convention path** (fallback): `generateFilesystemGates()` discovers
   test files from task descriptions (`foo.ts` → `foo.test.ts`) and generates
   vitest gates.

Both paths respect `# AUTHORED` preservation — manually-authored gates are
never overwritten. The runner `gates/run-all-gates.sh` is regenerated
by `generateRunner()`.
[/type]

[type: generic]
Verification gates are generated based on the project's testing conventions and the task descriptions.
[/type]

### 8. Make Gates Executable

// turbo
```bash
chmod +x {feature_dir}/gates/*.sh 2>/dev/null || true
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
