---
description: Generate idempotent beads import scripts from spec + plan + code audit
---

# /plan-to-beads

**Persona**: Senior Architect + Auditor
**Pillar**: Tracking (Visibility) + Quality (Precision)

<scope_constraints>
- Generates shell scripts ONLY. No `bd` commands are run by the agent.
- Output goes to `{feature_dir}/beads/` — scripts are git-tracked artifacts.
- Idempotent: running consecutively examines existing state and backfills only what is missing.
- The user executes the generated scripts in their own terminal.
- MUST use `$(cat << 'EOF' ... EOF)` for multiline `--description` values to prevent Bash expansion errors.
</scope_constraints>

<persistence>
This workflow spans a long analysis-and-generation cycle. Maintain state by writing the gap analysis to disk (`gap-analysis.md`) before generating scripts. Pause for user approval at Step 4b. Do not lose context between the gap analysis and script generation phases.
</persistence>

## Purpose

Analyzes spec, plan, contracts, mockups, AND actual implemented code to generate
a directory of executable shell scripts that create the complete beads hierarchy
(phases → tasks → dependencies) when run.

> **Core principle**: The AI's value is in *decomposition, gap analysis, and
> description quality* — producing tasks with zero interpretation required.
> Each task must be so precise that a dev agent can apply the diff and verify
> the result without asking a single question.

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)

## Prerequisites

- `{feature_dir}/spec.md` exists
- `{feature_dir}/plan.md` exists (v2 — with Governance & Skills Contract per phase)
- `{feature_dir}/.beads-id` exists with a `feature` key (created by `/specify`)

## Steps

### 1. Load Context (Deep Read)

Read and understand the feature deeply:
- `{feature_dir}/spec.md` — user stories, requirements, priorities
- `{feature_dir}/plan.md` — phases, file structure, Governance & Skills Contract, type dependency graph, mockup mappings
- `{feature_dir}/data-model.md` — if exists
- `{feature_dir}/contracts/` — MANDATORY. Method-level contracts define task boundaries.
- `{feature_dir}/mockups/` — if exists. Visual elements define UI task boundaries.
- `{feature_dir}/.beads-id` — existing tracking IDs
- `.agent/rules/` — read each governance rule referenced in plan.md's Governance & Skills Contract

### 2. Examine Existing State (Idempotency)

Before generating scripts, check what already exists:

```bash
FEATURE_ID=$(jq -r '.feature' {feature_dir}/.beads-id)

# Check for existing phases
bd children $FEATURE_ID 2>&1

# If phases exist, check for tasks within each
for phase_id in $(bd children $FEATURE_ID --json | jq -r '.[].id'); do
  bd children $phase_id 2>&1
done
```

If phases and/or tasks already exist:
- **Backfill mode**: Only generate scripts for missing phases/tasks
- Note existing IDs in `.phase-ids.json` as pre-populated values
- Report to user what exists vs what will be created

If the user explicitly requests regeneration of specific phases, regenerate those scripts only.

### 3. Read Actual Code (THE CRITICAL STEP)

For every file listed in `plan.md`:

1. **If the file exists** → read it completely. Note:
   - Which contract methods/types are implemented
   - Which fields are present vs missing vs wrong shape
   - Which governance rules are respected vs violated
2. **If the file doesn't exist** → note it as `greenfield`
3. **For existing files, compare against contracts/** — field by field:
   - Does `toResponse()` return all fields defined in the contract?
   - Do parameter types match the contract input schemas?
   - Are all enum values handled?

### 4. Gap Analysis → `gap-analysis.md` (REVIEWABLE CHECKPOINT)

For each contract method, shared type, mockup region, and governance rule:

| Check | Method |
|-------|--------|
| Contract compliance | Compare each contract method/type against implementation field-by-field |
| Mockup compliance | Compare each mockup region against the component's DOM/CSS |
| Governance compliance | Run skill-equivalent checks: fail-fast, no magic values |
| Test coverage | Are there tests? Do they assert meaningful outcomes or just status codes? |

Classify each finding:
- `greenfield` — no implementation exists, must create from scratch
- `wrong` — implementation exists but doesn't match contract/mockup/governance
- `missing` — partial implementation, specific fields/methods absent
- `dead` — code exists but is unreachable or stubbed (placeholder)
- `untested` — implementation correct but no tests verify it

#### 4a. Write `{feature_dir}/beads/gap-analysis.md`

> [!IMPORTANT]
> This artifact is MANDATORY. It makes the audit visible and reviewable.
> Without it, the agent can silently skip the audit and produce shallow tasks.

The gap analysis must be written to `{feature_dir}/beads/gap-analysis.md` using the template at `.specify/templates/gap-analysis-template.md`. Fill every `{{PLACEHOLDER}}` token.

#### 4b. Notify User for Review

Use `notify_user` with `gap-analysis.md` in `PathsToReview`. Set `BlockedOnUser: true`.

> "Gap analysis complete. {N} gaps found across {M} files.
> Review before I generate scripts."

**DO NOT proceed to Step 5 until the user approves the gap analysis.**
If the user requests changes (e.g., "you missed file X" or "that's already implemented"),
update `gap-analysis.md` and re-request review.

<halving_rule>
### 5. Decompose Using Halving Rule

For each gap from Step 4:

1. Define the smallest independently-verifiable unit of work
2. **Apply halving**: "Does this task contain 2+ independent verifiable outcomes?"
   - If yes → split into separate tasks
   - If no → it's one task
3. **Sizing constraint**: 1 task = 1 verifiable outcome, 0 interpretation required
   - NOT sized by hours or file count
   - Sized by: "Can a dev agent apply this diff and verify the result without asking a question?"

**Halving examples:**
| Before (too coarse) | After (halved) |
|---------------------|----------------|
| "Create Service with core CRUD" | "Create Service.create()" + "Add Service.list() with cursor pagination" + "Add Service.getBySlug()" |
| "Responsive polish and optimistic updates" | "Add 44px touch targets to interactive elements" + "Wire optimistic mutation for create" |
| "Create component suite" | "Create ComponentA" + "Create ComponentB" + "Create ComponentC" |
</halving_rule>

### 6. Compile-Chain Analysis

After decomposing all tasks, scan the type dependency graph from plan.md:

- If task A changes a type in `packages/domain` that task B's consumers depend on:
  - Mark B as `MUST-FOLLOW: A` (no independent tasks between them)
  - Both tasks go in the same execution batch
- Generate batch order automatically from the dependency graph
- Verify no circular dependencies exist

### 7. Write Task Descriptions

Every task description MUST follow the template at `.specify/templates/task-description-template.md`.
Fill every `{{PLACEHOLDER}}` token. Do not omit any section.

<output_rules>
- Every task MUST have a `## Verification` section with a literal shell command
- Every `describe`/`it` MUST map to FR-###, US-###, or TR-### from the spec
- Acceptance criteria MUST be literal shell commands, not prose
- Tasks MUST NOT bundle 2+ independently-verifiable outcomes
- Sizing is by verifiable outcome, not by hours or file count
</output_rules>

### Task Description Anti-Patterns
- ❌ Description without `## Verification` section (see `.specify/templates/task-description-template.md`)
- ❌ Acceptance criteria without a literal shell command
- ❌ "All components render" or "service compiles" as acceptance
- ❌ Task that bundles 2+ independently-verifiable outcomes
- ❌ Sizing by hours instead of verifiable outcomes
- ❌ "Create X" as a task name when X contains multiple methods/components

### 7a. Emit Verification Gates

For each task, generate `{feature_dir}/gates/{task_id}-gate.sh`.
See `.agent/templates/verification-gate.md` for format and assertion patterns.
Gates MUST exit 0 on pass, non-zero on fail. Also generate `gates/run-all-gates.sh`.
Gates are committed RED before implementation. `/implement` runs them; `/review-code` batches them.

> [!CAUTION]
> **Gates MUST be generated FROM contracts, not from task description prose.**
> Task descriptions are summaries — contracts are the source of truth.
> Weak gates that only check file existence cause infinite implement→review loops.

<gate_generation_rules>
For each task:
1. Identify the contract method(s) it implements (from `{feature_dir}/contracts/`)
2. For each contract field/return value:
   - Generate a `grep -q` or `jq -e` assertion against the implementation file
   - Assert the EXACT type signature, not just that a function exists
3. For each contract error case:
   - Generate a negative assertion (expected failure)
4. For each `## Files to Modify` entry:
   - Assert the **Target state** is present (not just that the file exists)
   - Assert the **Key constraint** is satisfied (e.g., `grep -q 'z.coerce.boolean()'`)
5. Number every assertion sequentially (assertion #1, #2, ...) so /review-code can
   reference SPECIFIC failures in its GATE field: `gates/T012-gate.sh assertion #3`
6. The gate MUST NOT paraphrase the contract — it MUST test the contract verbatim
</gate_generation_rules>

### 8. Generate Scripts

Create `{feature_dir}/beads/` directory with the following scripts:

#### `00-create-phases.sh`
Creates phase issues and captures IDs into `.phase-ids.json`. Check existence first (`bd children $FEATURE_ID`).

```bash
#!/bin/bash
# ... set up vars ...
EXISTING=$(bd children $FEATURE_ID --json | jq -r '...find Phase N...')
if [[ -n "$EXISTING" ]]; then
  PHASE_ID="$EXISTING"
else
  PHASE_ID=$(bd create --type task --parent $FEATURE_ID --title "Phase N: ..." --json | jq -r '.id')
fi
jq --arg id "$PHASE_ID" '.["N"] = $id' ... > .phase-ids.json
```

#### `NN-phase-N-tasks.sh` (one per phase)
Creates tasks within a phase using Heredocs to avoid bash expansion.

```bash
#!/bin/bash
# ... get PHASE_ID from .phase-ids.json ...
EXISTING_TASKS=$(bd children $PHASE_ID --json | jq -r '.[].title')

if ! echo "$EXISTING_TASKS" | grep -q "T0XX"; then
  bd create --type task --parent $PHASE_ID --title "T0XX: ..." \
    --description "$(cat << 'EOF'
<full task description markdown>
EOF
)" --json
fi
```

#### `NN-wire-dependencies.sh`

Wires cross-phase and MUST-FOLLOW dependencies.

#### `NN-update-beads-id.sh`

Updates `.beads-id` with all phase IDs.

#### `import-all.sh`

Master runner that executes all numbered scripts in order.

### 9. Make Scripts Executable

// turbo
```bash
chmod +x {feature_dir}/beads/*.sh
```

### 10. Report

Notify user with the hierarchy summary and gap analysis:

```
Scripts generated in {feature_dir}/beads/:
├── 00-create-phases.sh    (N phases)
├── 01-phase-1-tasks.sh    (N tasks, N greenfield, N remediation)
├── ...
├── NN-wire-dependencies.sh
├── NN-update-beads-id.sh
└── import-all.sh           ← run this

Gap Analysis Summary:
  Phase 1: N greenfield tasks, M remediation tasks
  Phase 2: ...

MUST-FOLLOW pairs:
  T0XX → T0YY (shared type compile-break)

To import: ./specs/.../beads/import-all.sh
To verify: bd children <FEATURE_ID>
```

<idempotency_contract>
| Scenario | Behavior |
|----------|----------|
| First run, nothing exists | Create all phases + tasks |
| Re-run, all exists | Skip everything, report "all up to date" |
| Re-run, some tasks missing | Create only missing tasks |
| Plan changed, new tasks needed | Regenerate scripts, user re-runs import-all.sh |
| User requests specific phase redo | Regenerate that phase's script only |
</idempotency_contract>

<stop_criteria>
- STOP at Step 4b and wait for user approval of gap-analysis.md
- Do NOT proceed to script generation without user sign-off on the gap analysis
- STOP if no `.beads-id` exists (run `/specify` first)
- STOP if no contracts/ exist and the spec has shared types or APIs (run `/plan` first)
</stop_criteria>

## Anti-Patterns

- ❌ Running `bd create` commands directly (generate scripts instead)
- ❌ Generating scripts without reading ACTUAL CODE (gap analysis is mandatory)
- ❌ Generating scripts without producing `gap-analysis.md` first (the audit must be visible)
- ❌ Proceeding past Step 4 without user approval of `gap-analysis.md`
- ❌ Creating tasks without literal code and `## Verification` sections
- ❌ Skipping idempotency checks in generated scripts
- ❌ Creating `tasks.md` or `phases/*.md` files (beads IS the task list)
- ❌ Producing tasks from plan.md alone without reading contracts/ and code
- ❌ Bundling 2+ independent outcomes in one task (halving rule violation)
- ❌ Using double quotes `"--description \"...\""` for descriptions. ALWAYS use `$(cat << 'EOF' ... EOF)` to prevent Bash variable/command evaluation errors on embedded code blocks.
- ❌ Generating or importing scripts without first verifying `bd doctor` or `bd ready` exits cleanly.

## Next Step

After scripts are generated:
- User runs `./specs/.../beads/import-all.sh` in their terminal
- User verifies with `bd children <FEATURE_ID>`
- Run `/implement {feature_dir} {phase_number}` to begin execution
