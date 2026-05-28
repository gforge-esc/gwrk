# Code Review for CLI Projects

**Persona**: Principal Engineer
**Pillar**: Shipping (Quality Gate)

<scope_constraints>
- Do NOT modify source code to fix issues. Document and re-open.
- DO auto-fix deterministic lint errors (`biome lint --write`).
- DO re-open failed tasks in tasks.json with structured remediation notes.
- DO re-open the phase if any tasks fail.
- DO post review summary as a PR comment.
- Evaluate against spec and plan, not personal preference.
- ONLY re-open tasks in the CURRENT phase. Do NOT touch tasks from other phases.
- ONLY run tests relevant to the current phase's files, not the full test suite.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to review (e.g., `0`)
- `pr_number`: Optional — PR to post review comment on

## Prerequisites

- `{feature_dir}/.gwrk/tasks.json` exists with phase and task entries
- Tasks exist in tasks.json (created via `/plan-to-tasks`)

## Algorithm

### 0. Build (MANDATORY)

gwrk is a CLI tool. No Docker, no web server.

```bash
pnpm build
```

> [!CAUTION]
> If `pnpm build` fails, report as **BLOCKING** infrastructure issue. Cannot proceed.

### 1. Load Context

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"
PHASE_ID="phase-{phase_number}"
```

Read:
- `{feature_dir}/spec.md` — requirements, acceptance criteria
- `{feature_dir}/plan.md` — Phase {N} section for file-level acceptance criteria

### 2. Verification Gates — PRIMARY VERDICT

> [!IMPORTANT]
> **Gates are truth, tasks.json status is bookkeeping.** If all gates pass, the task is done
> regardless of what `tasks.json` says. Run gates FIRST, then reconcile status.

```bash
GATE_PASS=true
if [ -f {feature_dir}/gates/run-all-gates.sh ]; then
  GATE_OUTPUT=$(bash {feature_dir}/gates/run-all-gates.sh 2>&1)
  GATE_EXIT=$?
  if [ $GATE_EXIT -ne 0 ]; then
    GATE_PASS=false
    # Map failed gates to tasks via gateScript field
  fi
fi
```

- **All gates pass (exit 0)**: Auto-complete all tasks in this phase:
  ```bash
  jq --arg pid "$PHASE_ID" \
    '(.phases[] | select(.id == $pid) | .tasks[].status) = "completed"' \
    "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
  ```
- **Any gate fails**: Map failed gate → task via `gateScript` field, re-open only those tasks.

### 3. Infrastructure Check

```bash
pnpm build 2>&1
```

- PASS: Build succeeds.
- FAIL: Document as blocking finding. Continue with file review.

### 4. Lint Check

```bash
pnpm lint 2>&1
```

- PASS: 0 errors.
- AUTO-FIX: If errors are auto-fixable, apply them:
  ```bash
  pnpm exec biome lint --write .
  git add {feature_dir}/.gwrk/tasks.json && git commit -m "review: auto-fix lint errors"
  ```
- REMAINING: Document non-auto-fixable errors as findings.

### 5. Reconcile Task State

If gates passed in Step 2, tasks are already completed. Skip to Step 6.

If gates failed or no gates exist, check tasks.json:
```bash
CLOSED=$(jq --arg pid "$PHASE_ID" '[.phases[] | select(.id == $pid) | .tasks[] | select(.status == "completed")]' "$TASKS_FILE")
NOT_CLOSED=$(jq --arg pid "$PHASE_ID" '[.phases[] | select(.id == $pid) | .tasks[] | select(.status != "completed")]' "$TASKS_FILE")
```

For tasks still open AND whose gates failed: re-open with structured remediation notes.
For tasks still open BUT whose gates passed: auto-complete them — the gate is truth.

### 6. Task Review Loop

For each task (completed or not) in the phase:

a. **File Check**: Do referenced files exist?
   - PASS: File exists at expected path.
   - FAIL: Record finding.

b. **Spec Match**: Does code implement the acceptance criteria from `plan.md`?
   - PASS: Implementation matches plan's acceptance criteria.
   - FAIL: Record finding with specific deviation.

c. **Type Safety**: No `any` types in non-test critical paths?
   - PASS: Strict typing.
   - FAIL: Record finding.

### 7. Test Verification

Run ONLY phase-relevant tests, not the full suite:

```bash
# Identify test files from this phase's tasks
TEST_FILES=$(jq -r --arg pid "$PHASE_ID" '.phases[] | select(.id == $pid) | .tasks[].title' "$TASKS_FILE" | grep -oE 'src/[^ ]+\.ts' | sed 's/\.ts$/.test.ts/' | xargs -I{} sh -c 'test -f "{}" && echo "{}"')
pnpm vitest run $TEST_FILES --reporter=verbose 2>&1
```

- PASS: All phase tests pass.
- FAIL: Document which tests fail and why. Only re-open tasks in THIS phase.

### 8. Apply Task State Changes

For each failed task:

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"

# Re-open the task
jq --arg n "{phase_number}" --arg t "$TASK_ID" \
  '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).status = "open"' \
  "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"

# Append structured remediation notes to the task description
jq --arg n "{phase_number}" --arg t "$TASK_ID" --arg note "$(cat <<'EOF'
REVIEW FAIL (code): {check_name} — {FR_REF}.
  WHERE: {file_path}:{line_range}
  EXPECTED: {exact_expected_code_or_pattern}
  ACTUAL: {exact_actual_code_or_pattern}
  FIX: {specific_remediation}
  GATE: {gate_script_path} assertion #{N}
  REF: plan.md Phase {N} > {section}
EOF
)" '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).description += "\n\n" + $note' \
  "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
```

### 9. Post PR Comment

If `pr_number` provided:

Write the review to `/tmp/review-{phase_number}.md`. Post:

```bash
gh pr comment {pr_number} --body-file /tmp/review-{phase_number}.md
```

### 10. Commit Review State

```bash
# Phase-scoped commit — NEVER use git add -A
git add {feature_dir}/.gwrk/tasks.json
git diff --cached --quiet || git commit -m "review: code review Phase {phase_number} - {GO|NO-GO}"
```

<verdict_criteria>
- **GO**: All tasks remain completed. Lint clean. Tests pass.
- **NO-GO**: Any task re-opened. Blocking findings exist.
</verdict_criteria>

<closed_loop_contract>
| Review finds... | Action taken | `/implement` sees... |
|-----------------|-------------|---------------------|
| Task not implemented | Update status to open + append note | Task in ready queue with notes |
| Task fails spec match | Update status to open + append note | Task in ready queue with remediation |
| Auto-fixable lint | `biome lint --write` + commit | Clean lint (resolved) |
| Non-fixable lint | Note on relevant task | Task in ready queue with lint details |
| Test failures | Note on relevant task(s) | Task(s) in ready queue with test output |
</closed_loop_contract>

<note_format>
Notes MUST follow this enhanced structure for `/implement` to parse effectively.

```
REVIEW FAIL ({review_type}): {check_name} — {FR_REF}.
  WHERE: {file_path}:{line_range}
  EXPECTED: {exact_expected_code_or_pattern}
  ACTUAL: {exact_actual_code_or_pattern}
  FIX: {specific_remediation}
  GATE: {gate_script_path} assertion #{N}
  REF: plan.md Phase {N} > {section}
```

| Field | Purpose | Example |
|---|---|---|
| `WHERE` | Exact location for the agent to read | `src/engine/plan-solver.ts:42-58` |
| `EXPECTED` | What the contract/spec requires | `export function compare(a: ASTNode, b: ASTNode): DiffResult` |
| `ACTUAL` | What the implementation has | `export function compare(a: any, b: any): any` |
| `FIX` | Specific action to take | `Replace any types with ASTNode and DiffResult from contracts/parser-api.md` |
| `GATE` | Which gate assertion failed | `gates/T012-gate.sh assertion #3` |
</note_format>

## Anti-Patterns

- ❌ Fix source code (re-open the task instead)
- ❌ Skip gate execution when gates/*.sh exist
- ❌ Leave failed tasks in completed state
- ❌ Reference `tasks.md` or `phases/*.md` (tasks.json is the source of truth)
- ❌ Skip the PR comment (it's the audit trail)
- ❌ Write vague notes ("needs fix" — always include the specific remediation)
- ❌ Using tasks.json status as primary verdict when gates exist (gates are truth)
- ❌ Running `git add -A` (scope commits to phase files and tasks.json only)
- ❌ Re-opening tasks from OTHER phases (only touch tasks in the current phase)
- ❌ Running `pnpm test` globally (run only phase-relevant test files)

## JSON Intent Format

Your final output must be a single JSON object containing:
- `summary`: A concise description of the review results.
- `verdict`: "GO" if all checks pass and all tasks remain completed, "NO-GO" otherwise.
- `reopenedTasks`: Array of task IDs that were re-opened.
- `intents`: Array of `WRITE_FILE` or `RUN_COMMAND` actions to apply changes (e.g., updating `tasks.json`, running lint --write).
