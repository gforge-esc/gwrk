# /gwrk-implement

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

### 2. Task Loop (Greedy)

... (rest of the steps from the original implement workflow)
