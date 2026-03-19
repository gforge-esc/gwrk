---
description: Technical code review of implementation against spec.
---

# /gwrk-review-code

**Persona**: Principal Engineer
**Pillar**: Shipping (Quality Gate)

<scope_constraints>
- Do NOT modify source code to fix issues. Document and re-open.
- DO auto-fix deterministic lint errors (`biome lint --write`).
- DO re-open failed tasks in tasks.json with structured remediation notes.
- DO re-open the phase if any tasks fail.
- DO post review summary as a PR comment.
- Evaluate against spec and plan, not personal preference.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to review (e.g., `0`)
- `pr_number`: Optional — PR to post review comment on

## Prerequisites

- `{feature_dir}/.gwrk/tasks.json` exists with phase and task entries
- Tasks exist in tasks.json (created via `/plan-to-tasks`)

## Algorithm

### 0. Dev Environment (I-007 — MANDATORY)

```bash
# Kill any zombie dev processes
pkill -f 'pnpm.*dev' || true

# STRICT DOCKER MANDATE
make up
./scripts/dev/verify-dev-stack.sh
```

> [!CAUTION]
> Do NOT use bare `pnpm dev`. Do NOT override ports.

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

```bash
pnpm test 2>&1
```

- PASS: All tests pass.
- FAIL: Document which tests fail and why.

E2E (if UI phase):
```bash
make test-e2e 2>&1
```

- PASS: All pass.
- FAIL: Mark as blocking.
- SKIP: Only if phase has no UI. Document reason.

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

For tasks never implemented (still open/in_progress):

```bash
# Append NOT IMPLEMENTED note
jq --arg n "{phase_number}" --arg t "$TASK_ID" \
  '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).description += "\n\nREVIEW FAIL (code): NOT IMPLEMENTED — task was not completed. See plan.md Phase {N} for requirements."' \
  "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
```

### 9. Post PR Comment

If `pr_number` provided:

Write the review to `/tmp/review-{phase_number}.md` using the template at `.specify/templates/review-code-comment-template.md`. Fill every `{{PLACEHOLDER}}` token.

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

Report via notify_user:
```
Code Review: {GO|NO-GO}
Phase: {phase_number}
Tasks: {PASS_COUNT}/{TOTAL} pass, {FAIL_COUNT} re-opened
PR comment: #{pr_number} (if applicable)

Next:
  GO   → /review-uat {feature_dir} {phase_number}
  NO-GO → /implement {feature_dir} {phase_number}
          (re-opened tasks are in the ready queue)
```

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
The implement agent's `<escalation_protocol>` depends on these fields:

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
| `WHERE` | Exact location for the agent to read | `packages/core/src/pipeline/compare.ts:42-58` |
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

## Next Step

After code review:
- If GO: Run `/review-uat {feature_dir} {phase_number}`
- If NO-GO: Run `/implement {feature_dir} {phase_number}` — re-opened tasks appear in the ready queue
