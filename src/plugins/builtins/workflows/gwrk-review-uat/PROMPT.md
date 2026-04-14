# /gwrk-review-uat

**Persona**: Product Manager
**Pillar**: Delivery (Value Verification)

<scope_constraints>
- Do NOT modify source code to fix issues. Document and re-open.
- DO re-open failed tasks in tasks.json with structured remediation notes.
- DO re-open the phase if any tasks fail.
- DO post review summary as a PR comment.
- Evaluate user experience and acceptance criteria, not code quality.
- ONLY evaluate user stories and requirements in the prompt's "Requirements in scope" section.
- Do NOT evaluate stories from other phases. If a requirement is not listed, skip it.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/014-plugin-system`)
- `phase_number`: Phase to review (e.g., `5`)
- `pr_number`: Optional — PR to post review comment on

## Prerequisites

- `/review-code` has passed (GO verdict) for this phase
- `{feature_dir}/.gwrk/tasks.json` exists with phase and task entries

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
```

Read:
- `{feature_dir}/spec.md` — user stories, acceptance criteria
- `{feature_dir}/plan.md` — Phase {N} acceptance criteria and "Done When"

**CRITICAL**: Check the prompt for `Requirements in scope:` and `Done When:`. Only evaluate those requirements. Do not test stories from other phases.

### 2. Get Closed Tasks

```bash
TASKS_FILE="{feature_dir}/.gwrk/tasks.json"
CLOSED=$(jq --arg n "{phase_number}" '[.phases[] | select(.id == $n) | .tasks[] | select(.status == "completed")]' "$TASKS_FILE")
```

### 3. CLI Command Verification

gwrk commands follow this taxonomy:
- `gwrk define spec <feature>` — create/rework a spec (NOT `gwrk specify`)
- `gwrk define plan <feature>` — create a plan
- `gwrk define tasks <feature>` — generate tasks
- `gwrk ship <feature> <phase>` — ship a phase
- `gwrk plugin list` — list plugins

For each user story in scope:

a. **Golden Path**: Execute the CLI command described in the acceptance criteria.
   - Run the command with valid arguments
   - Check exit code: `echo $?`
   - Check stdout/stderr for expected output
   - PASS: Command produces expected behavior.
   - FAIL: Record finding with command, expected vs actual.

b. **Negative Path**: Test error conditions from spec.
   - Missing arguments, invalid input, missing config
   - PASS: Graceful error with corrective message, non-zero exit.
   - FAIL: Record confusing or missing error handling.

c. **Unit Tests**: Verify relevant test suites pass.
   ```bash
   pnpm vitest run <relevant-test-file> --reporter=verbose
   ```
   - PASS: All tests green.
   - FAIL: Record failing tests.

### 4. "Done When" Verification

Execute each item in the plan's "Done When" criteria literally and verify the result.

### 5. Apply Task State Changes

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

### 6. Post PR Comment

If `pr_number` provided:

Write the review to `/tmp/uat-review-{phase_number}.md`. Post:

```bash
gh pr comment {pr_number} --body-file /tmp/uat-review-{phase_number}.md
```

### 7. Commit Review State

```bash
git add {feature_dir}/.gwrk/tasks.json
git diff --cached --quiet || git commit -m "review: UAT Phase {phase_number} - {GO|NO-GO}"
```

<verdict_criteria>
- **GO**: All in-scope user stories pass acceptance criteria. All relevant tests pass.
- **NO-GO**: Any in-scope story fails. Only re-open tasks for in-scope failures.
</verdict_criteria>

Report via notify_user:
```
UAT: {GO|NO-GO}
Phase: {phase_number}
Stories: {PASS_COUNT}/{TOTAL} pass, {FAIL_COUNT} re-opened

Next:
  GO   → Ready for merge. PM may set 🟢 GREEN.
  NO-GO → /implement {feature_dir} {phase_number}
          (re-opened tasks are in the ready queue)
```

<closed_loop_contract>
| UAT finds... | Action taken | `/implement` sees... |
|--------------|-------------|---------------------|
| CLI command returns wrong exit code | Update status to open + append note | Task with expected vs actual exit code |
| Missing error message | Update status to open + append note | Task with expected stderr message |
| Test failure | Update status to open + append note | Task with test file and failure details |
| "Done When" item fails | Update status to open + append note | Task with specific failed criterion |
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
- ❌ Evaluate code quality (that's `/review-code`'s job)
- ❌ Write vague notes ("looks wrong" — always include expected vs actual)
- ❌ Test stories from other phases (stick to "Requirements in scope")
- ❌ Use `gwrk specify` (correct command is `gwrk define spec`)

## Next Step

After UAT:
- If GO: Feature/phase ready for merge. PM sets 🟢 GREEN.
- If NO-GO: Run `/implement {feature_dir} {phase_number}` — re-opened tasks appear in the ready queue
