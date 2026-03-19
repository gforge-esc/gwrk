---
description: User acceptance testing of implementation against spec.
---

# /gwrk-review-uat

**Persona**: Product Manager
**Pillar**: Delivery (Value Verification)

<scope_constraints>
- Do NOT modify source code to fix issues. Document and re-open.
- DO re-open failed tasks in tasks.json with structured remediation notes.
- DO re-open the phase if any tasks fail.
- DO post review summary as a PR comment.
- DO capture screenshot evidence for UI findings.
- Evaluate user experience and acceptance criteria, not code quality.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to review (e.g., `3`)
- `pr_number`: Optional — PR to post review comment on

## Prerequisites

- `/review-code` has passed (GO verdict) for this phase
- `{feature_dir}/.gwrk/tasks.json` exists with phase and task entries

## Algorithm

### 0. Dev Environment (I-007 — MANDATORY)

```bash
# Kill any zombie dev processes
pkill -f 'pnpm.*dev' || true

# STRICT DOCKER MANDATE — UAT always needs the running app
make up
./scripts/dev/verify-dev-stack.sh
```

> [!CAUTION]
> Do NOT use bare `pnpm dev`. UAT requires `http://localhost` via Docker.
> If the gate fails, report as **BLOCKING** infrastructure issue.

### 1. Load Context

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"
```

Read:
- `{feature_dir}/spec.md` — user stories, acceptance criteria
- `{feature_dir}/plan.md` — Phase {N} acceptance criteria
- `{feature_dir}/mockups/` — if exists, for visual comparison

### 2. Get Closed Tasks

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"
CLOSED=$(jq --arg n "{phase_number}" '[.phases[] | select(.id == $n) | .tasks[] | select(.status == "completed")]' "$TASKS_FILE")
```

### 3. Infrastructure Verification

The dev stack was started in Step 0. Verify the app is accessible:

```bash
# Verify UI loads (browser tool or curl)
curl -sf http://localhost/ > /dev/null || { echo "BLOCKING: Web UI not reachable"; }
curl -sf http://localhost/api > /dev/null || { echo "BLOCKING: API not reachable"; }
```

- PASS: App starts, UI loads in browser at `http://localhost`.
- FAIL: Document as **BLOCKING**. Cannot proceed with UAT. Re-open phase.

### 4. User Story Testing

For each user story / acceptance criterion in scope:

a. **Golden Path**: Execute the primary user flow.
   - Navigate to the relevant page/component
   - Perform the actions described in the spec
   - PASS: Flow completes as described.
   - FAIL: Record finding with the specific step that fails.

b. **Visual Fidelity**:
   - Compare against `{feature_dir}/mockups/` if available
   - PASS: Matches spec visual requirements.
   - FAIL: Record deviations with screenshots.

c. **Error States**: Trigger error conditions.
   - Empty states, network failures, invalid input
   - PASS: Graceful handling, clear user messaging.
   - FAIL: Record confusing or missing error states.

d. **Edge Cases**: Test boundaries defined in spec.
   - Max lengths, empty lists, concurrent actions
   - PASS: Edge cases handled.
   - FAIL: Record which edge cases break.

### 5. Capture Evidence

Use browser tool to capture screenshots for:
- Each successful flow (proof of completion)
- Each failure (evidence for remediation)
- Visual fidelity issues

Save to `{feature_dir}/reviews/uat-phase-{N}/` for audit trail.

### 6. Apply Task State Changes

For each failed acceptance criterion, identify the related task(s) and:

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"

# Re-open the task
jq --arg n "{phase_number}" --arg t "$TASK_ID" \
  '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).status = "open"' \
  "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"

# Append structured remediation notes
jq --arg n "{phase_number}" --arg t "$TASK_ID" --arg note "REVIEW FAIL (uat): {story_name} — Expected: {what_user_expects}. Actual: {what_happened}. See spec.md > {story_ref}. Fix: {specific_remediation}." \
  '(.phases[] | select(.id == $n) | .tasks[] | select(.id == $t)).description += "\n\n" + $note' \
  "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
```

### 7. Post PR Comment

If `pr_number` provided:

Write the review to `/tmp/uat-review-{phase_number}.md` using the template at `.specify/templates/review-uat-comment-template.md`. Fill every `{{PLACEHOLDER}}` token.

```bash
gh pr comment {pr_number} --body-file /tmp/uat-review-{phase_number}.md
```

### 8. Commit Review State

```bash
git add -A && git commit -m "review: UAT Phase {phase_number} - {GO|NO-GO}"
```

<verdict_criteria>
- **GO**: All user stories pass acceptance criteria. All tests pass.
- **NO-GO**: Any story fails. Visual deviations from spec.
</verdict_criteria>

Report via notify_user:
```
UAT: {GO|NO-GO}
Phase: {phase_number}
Stories: {PASS_COUNT}/{TOTAL} pass, {FAIL_COUNT} re-opened
PR comment: #{pr_number} (if applicable)

Next:
  GO   → Ready for merge. PM may set 🟢 GREEN.
  NO-GO → /implement {feature_dir} {phase_number}
          (re-opened tasks are in the ready queue)
```

<closed_loop_contract>
| UAT finds... | Action taken | `/implement` sees... |
|--------------|-------------|---------------------|
| Story fails golden path | Update status to open + append note | Task in ready queue with UX notes |
| Visual fidelity issue | Update status to open + append note | Task with screenshot refs |
| Error state missing | Update status to open + append note | Task with expected error behavior |
| Edge case breaks | Update status to open + append note | Task with boundary details |
</closed_loop_contract>

<note_format>
Notes MUST follow this structure for `/implement` to parse effectively:

```
REVIEW FAIL (uat): {story_name} — Expected: {what_user_expects}. Actual: {what_happened}. See spec.md > {story_ref}. Fix: {specific_remediation}.
```
</note_format>

## Anti-Patterns

- ❌ Fix source code (re-open the task instead)
- ❌ Leave failed tasks in completed state
- ❌ Run UAT before `/review-code` passes
- ❌ Skip screenshot evidence for visual findings
- ❌ Evaluate code quality (that's `/review-code`'s job)
- ❌ Write vague notes ("looks wrong" — always include expected vs actual)

## Next Step

After UAT:
- If GO: Feature/phase ready for merge. PM sets 🟢 GREEN.
- If NO-GO: Run `/implement {feature_dir} {phase_number}` — re-opened tasks appear in the ready queue
