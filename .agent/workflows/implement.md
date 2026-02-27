---
description: Execute a single phase from a feature to absolute completion
---

# /implement

**Persona**: Senior Developer
**Pillar**: Shipping (Throughput)

<persistence>
You are executing a phase to completion. Keep going until all tasks in the phase are closed or you are blocked. Do not yield to the user between tasks — the phase is one unit of work. Only stop when the ready queue is empty, a task is blocked, or escalation triggers.
</persistence>

## Purpose

Executes ALL TASKS in a phase greedily via the tasks.json ready queue. Each task is tracked individually in tasks.json. Phase completion is derived from all tasks in the phase having status "completed".

<scope_constraints>
- Execute ALL tasks in the specified phase
- Do NOT proceed to another phase — STOP when this phase is done
- Do NOT mark a task done until verification passes
- If blocked, STOP and report — do not work around
- MUST create a PR after phase completion
</scope_constraints>

<branch_constraints>
**CRITICAL**: This workflow creates and manages the feature branch.
- At preflight, create `feat/{feature_name}` from `develop` if it doesn't exist
- If the feature branch already exists, check it out and merge latest `develop`
- All implementation commits go on the feature branch
- PR targets `develop` (not `main`)
- Do NOT merge or push to `main` directly
</branch_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to execute (e.g., `2`)

## Algorithm

### 0. Dev Environment (I-007 — MANDATORY)

```bash
# Kill any zombie dev processes from previous sessions
pkill -f 'pnpm.*dev' || true

# STRICT DOCKER MANDATE — all dev runs in Docker
make up
./scripts/dev/verify-dev-stack.sh
```

> [!CAUTION]
> Do NOT run bare `pnpm dev`. Do NOT override ports. If the connectivity gate fails, STOP and report.

### 1. Preflight

```bash
# === Branch Setup ===
FEATURE_NAME=$(basename {feature_dir})
BRANCH_NAME="feat/$FEATURE_NAME"

# Fetch latest remote refs
git fetch origin 2>/dev/null || true

# Create or update feature branch from develop
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    # Local branch exists — checkout and merge latest develop
    git checkout "$BRANCH_NAME"
    git merge develop --no-edit
elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
    # Remote branch exists but no local — track it and merge develop
    git checkout -b "$BRANCH_NAME" "origin/$BRANCH_NAME"
    git merge develop --no-edit
else
    # Branch doesn't exist locally or remotely — create from develop
    git checkout develop
    git pull origin develop 2>/dev/null || true
    git checkout -b "$BRANCH_NAME"
fi

# Verify tasks.json exists and has the phase
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"
if [[ ! -f "$TASKS_FILE" ]]; then
  STOP: "tasks.json not found. Run /plan-to-tasks first."
fi

PHASE=$(jq -e --arg n "{phase_number}" '.phases[] | select(.id == $n)' "$TASKS_FILE")
if [[ -z "$PHASE" ]]; then
  STOP: "Phase {phase_number} not in tasks.json. Run /plan-to-tasks first."
fi

# DETERMINISTIC FAILSAFE: Stop if no work found
READY_COUNT=$(jq --arg n "{phase_number}" '[.phases[] | select(.id == $n) | .tasks[] | select(.status == "open")] | length' "$TASKS_FILE")
if [[ "$READY_COUNT" -eq 0 ]]; then
  echo "✓ No open tasks for Phase {phase_number}. Assuming completion."
  exit 0
fi
```

<stop_criteria>
- STOP if tasks.json has 0 open tasks for this phase (phase is complete or un-planned)
- STOP if a task reaches Round 4+ of escalation (3+ review failures)
- STOP if `make up` or `verify-dev-stack.sh` fails (infrastructure broken)
- STOP if the agent cannot determine which files to modify (missing plan.md context)
- Do NOT stop between tasks — continue to next ready task
- Do NOT stop to ask clarifying questions — implement from task description
- Do NOT "self-heal" by running setup scripts when no work is found
</stop_criteria>

### 2. Task Loop (Greedy)

```
while true:
    TASKS_FILE="{feature_dir}/.gwrk/tasks.json"

    # Get next open task in this phase
    NEXT_TASK=$(jq -r --arg n "{phase_number}" '[.phases[] | select(.id == $n) | .tasks[] | select(.status == "open")][0].id // empty' "$TASKS_FILE")

    if [[ -z "$NEXT_TASK" ]]:
        break  # All tasks complete

    # === Load Context ===
    TASK_DESC=$(jq -r --arg n "{phase_number}" --arg t "$NEXT_TASK" '.phases[] | select(.id == $n) | .tasks[] | select(.id == $t) | .description // .title' "$TASKS_FILE")
    # Read plan.md and relevant source files for context
    # If task has review remediation notes, follow them

<read_before_write>
Before writing ANY code for a task, the agent MUST:
1. Read EVERY file listed in the task's ## Files to Modify section
2. If REVIEW FAIL notes exist, also read: `cat {feature_dir}/gates/{task_id}-gate.sh`
3. Compare current file state against the task's ## Target state
4. Only THEN plan and write code — targeting the specific gaps

Rationale: "Never speculate about code you have not opened" (Claude 4.6 guide).
"Map the scope before coding" (GPT-5.2 guide).
</read_before_write>

    # === Mark in-progress ===
    jq --arg n "{phase_number}" --arg t "$NEXT_TASK" \
      '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).status = "in_progress"' \
      "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"

    # === IMPLEMENT ===
    # Agent implements based on task description, plan.md, and spec.md
    # Task descriptions contain literal code — apply the diff

<review_notes_priority>
If task description contains "REVIEW FAIL", the agent MUST:
1. Address the SPECIFIC remediation in the notes FIRST
2. Verify the remediation manually (e.g., grep, jq check)
3. ONLY THEN run the gate script

Notes from /review-code are binding — they override gate-only logic.
The gate is necessary but NOT sufficient when notes exist.
</review_notes_priority>

<escalation_protocol>
Check how many times this task has been re-opened (count REVIEW FAIL entries in description).
Adjust strategy based on round:

Round 1 (first attempt — no REVIEW FAIL notes):
  Implement from task description. Standard flow.

Round 2 (after first review fail):
  1. Read the REVIEW FAIL notes verbatim — WHERE, EXPECTED, ACTUAL, FIX
  2. Read the gate script that failed: `cat {feature_dir}/gates/{task_id}-gate.sh`
  3. Run the gate and capture EXACT output
  4. Read the contract method the gate tests
  5. Implement targeting the SPECIFIC assertion gaps only

Round 3 (after second review fail):
  1. Re-read the FULL spec.md section for this FR-###
  2. Re-read the contract file for this task
  3. Diff your implementation against the contract field-by-field
  4. Write a 3-line remediation plan BEFORE writing any code
  5. Implement ONLY the remediation plan — no other changes

Round 4+ (third+ review fail): STOP. Report to user with:
  - Gate script path and its EXACT output
  - Your implementation vs contract diff (field-by-field)
  - Your hypothesis for why the gate still fails
  - Proposed approach for human review
  Mark task as blocked in tasks.json.
</escalation_protocol>

<skill_gates>
1. Read the ## Skills section from the task description
2. For each listed skill: `view_file .agent/skills/{skill}/SKILL.md` and apply its checks to the code just written
3. ALWAYS run compile-gate even if not listed in ## Skills (compile-gate is implicit — like a seatbelt, you don't list it, you wear it)

The skills are NOT guessed from what files were touched.
They are EXPLICITLY listed in the task description, propagated from plan.md's Governance & Skills Contract.
The agent reads and follows — no interpretation.
</skill_gates>

<verification_rules>
Run the pre-committed gate script (written by /plan-to-tasks, NOT by this agent):
  `bash {feature_dir}/gates/{task_id}-gate.sh`

- Gate exits 0 = PASS, non-zero = FAIL
- If no gate file exists, run the ## Verification section from the task description
- If verification fails, follow the `<escalation_protocol>` above
- The old "3 attempts then block" rule is replaced by the escalation rounds
</verification_rules>

    # === Complete ===
    jq --arg n "{phase_number}" --arg t "$NEXT_TASK" \
      '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).status = "completed"' \
      "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
    git add -A && git commit -m "feat: $NEXT_TASK done"
```

### 3. Phase Completion

```bash
git add -A && git commit -m "feat: Phase {phase_number} complete"
```

### 4. Create Pull Request

```bash
TASKS_SUMMARY=$(jq -r --arg n "{phase_number}" '.phases[] | select(.id == $n) | .tasks[] | "- [x] \(.title)"' "$TASKS_FILE")

gh pr create \
  --title "feat($(basename {feature_dir})): Phase {phase_number} - {phase_name}" \
  --body "## Summary
{Brief description}

## Tasks Completed
$TASKS_SUMMARY

## Verification
- [x] All tasks verified
" \
  --base develop
```

### 5. Cleanup & Report

```bash
# Kill any local dev processes started during session
pkill -f 'pnpm.*dev' || true
```

```
Phase {phase_number} COMPLETE.
Tasks: $(jq --arg n "{phase_number}" '[.phases[] | select(.id == $n) | .tasks[]] | length' "$TASKS_FILE") completed
PR: #{pr_number}
```

<quality_gate>
Before closing any task, verify:
1. One task at a time — agent cannot start T002 until T001 is closed
2. Verification required — agent must run gate script or ## Verification before closing
3. Greedy but gated — agent loops autonomously but cannot skip verification
4. Commit per task — each task gets its own commit for auditability
5. Docker-first — dev stack via `make up`, never bare `pnpm dev`
</quality_gate>

## Anti-Patterns

- ❌ Mark task done without verification passing
- ❌ Edit or delete gate files in `gates/` (they are pre-committed acceptance contracts)
- ❌ Skip to "easier" tasks
- ❌ Batch commits (each task = one commit)
- ❌ Proceed to next phase without user instruction
- ❌ Reference `tasks.md` or `phases/*.md` (tasks.json is the source of truth)
- ❌ Run bare `pnpm dev` without `make up` first (I-007)
- ❌ Leave dev processes running after phase completion (I-007)
- ❌ Attempt to "Self-Heal" if no open tasks are found by running setup scripts. If no work is found, report and STOP.
