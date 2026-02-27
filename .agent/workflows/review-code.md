---
description: Technical code review of implementation against spec.
---

# /review-code

**Persona**: Principal Engineer
**Pillar**: Shipping (Quality Gate)

<scope_constraints>
- Do NOT modify source code to fix issues. Document and re-open.
- DO auto-fix deterministic lint errors (`biome lint --write`).
- DO re-open failed beads tasks with structured remediation notes.
- DO re-open the phase if any tasks fail.
- DO post review summary as a PR comment.
- Evaluate against spec and plan, not personal preference.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to review (e.g., `0`)
- `pr_number`: Optional — PR to post review comment on

## Prerequisites

- `{feature_dir}/.beads-id` exists with phase mapping
- Phase and tasks exist in beads (created via `/plan-to-beads`)

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
FEATURE_ID=$(jq -r '.feature' {feature_dir}/.beads-id)
PHASE_ID=$(jq -r --arg n "{phase_number}" '.phases[$n]' {feature_dir}/.beads-id)
```

Read:
- `{feature_dir}/spec.md` — requirements, acceptance criteria
- `{feature_dir}/plan.md` — Phase {N} section for file-level acceptance criteria

### 2. Get Closed Tasks

```bash
# Get all tasks in the phase
TASKS=$(bd children $PHASE_ID --json)

# Separate closed vs other
CLOSED=$(echo $TASKS | jq '[.[] | select(.status == "closed")]')
NOT_CLOSED=$(echo $TASKS | jq '[.[] | select(.status != "closed")]')
```

If tasks are not yet closed, they were never implemented — flag as NOT IMPLEMENTED.

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
  git add -A && git commit -m "review: auto-fix lint errors"
  ```
- REMAINING: Document non-auto-fixable errors as findings.

### 5. Verification Gates (if gates exist)

```bash
if [ -f {feature_dir}/gates/run-all-gates.sh ]; then
  bash {feature_dir}/gates/run-all-gates.sh 2>&1
fi
```

- PASS: All gates exit 0. Record gate score.
- FAIL: Document which gates fail. Map failed gates to beads tasks for re-opening.

### 6. Task Review Loop

For each task (closed or not) in the phase:

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

### 8. Apply Beads State Changes

For each failed task:

```bash
# Re-open the task
bd update $TASK_ID --status open

# Attach structured remediation notes (enhanced format for implement agent parsing)
bd update $TASK_ID --notes "$(cat <<'EOF'
REVIEW FAIL (code): {check_name} — {FR_REF}.
  WHERE: {file_path}:{line_range}
  EXPECTED: {exact_expected_code_or_pattern}
  ACTUAL: {exact_actual_code_or_pattern}
  FIX: {specific_remediation}
  GATE: {gate_script_path} assertion #{N}
  REF: plan.md Phase {N} > {section}
EOF
)"
```

For tasks never implemented (still open/in_progress):

```bash
bd update $TASK_ID --status open
bd update $TASK_ID --notes "REVIEW FAIL (code): NOT IMPLEMENTED — task was not completed. See plan.md Phase {N} for requirements."
```

If any tasks failed, re-open the phase:

```bash
bd update $PHASE_ID --status in_progress
bd update $PHASE_ID --notes "CODE REVIEW: NO-GO. {PASS_COUNT}/{TOTAL} pass, {FAIL_COUNT} re-opened. Next: /implement {feature_dir} {phase_number}"
```

### 9. Post PR Comment

If `pr_number` provided:

Write the review to `/tmp/review-{phase_number}.md` using the template at `.specify/templates/review-code-comment-template.md`. Fill every `{{PLACEHOLDER}}` token.

```bash
gh pr comment {pr_number} --body-file /tmp/review-{phase_number}.md
```

### 10. Commit Review State

```bash
git add -A && git commit -m "review: code review Phase {phase_number} - {GO|NO-GO}"
```

<verdict_criteria>
- **GO**: All tasks remain closed. Lint clean. Tests pass.
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
| Task not implemented | `bd update --status open --notes` | Task in ready queue with notes |
| Task fails spec match | `bd update --status open --notes` | Task in ready queue with remediation |
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
- ❌ Leave failed tasks in closed state
- ❌ Reference `tasks.md` or `phases/*.md` (beads is the source of truth)
- ❌ Skip the PR comment (it's the audit trail)
- ❌ Write vague notes ("needs fix" — always include the specific remediation)
- ❌ Use `bd create` to re-open a task (ALWAYS `bd update $TASK_ID --status open`. Creating a new bead for a failed task is a data corruption bug that produces duplicate tasks.)

## Next Step

After code review:
- If GO: Run `/review-uat {feature_dir} {phase_number}`
- If NO-GO: Run `/implement {feature_dir} {phase_number}` — re-opened tasks appear in the ready queue
