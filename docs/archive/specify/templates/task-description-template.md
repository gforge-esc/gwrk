## What
{{ONE_SENTENCE_WHAT_CHANGES_AND_WHY}}

## Why
{{GAP_REFERENCE}} — closes {{CONTRACT_OR_FR_REF}}.

## Skills
{{SKILLS_FROM_PLAN_PHASE_CONTRACT}}
- compile-gate

## Depends On
{{DEPENDENCIES}}
<!-- If compile-break risk: MUST-FOLLOW: {{TASK_ID}} -->

## Files to Modify
- `{{FILE_PATH}}`:
  - **Current state**: {{WHAT_EXISTS_NOW — from gap analysis, or "greenfield" if new file}}
  - **Target state**: {{EXACT_CODE_SIGNATURE_OR_SHAPE — from contract}}
  - **Key constraint**: {{SPECIFIC_RULE — e.g. "must use z.coerce.boolean()", "no magic values"}}

## Acceptance Criteria (ALL must pass)
1. `{{SHELL_COMMAND_1}}` → exits 0
2. `{{SHELL_COMMAND_2}}` → outputs `{{EXPECTED}}`
3. `grep -q '{{PATTERN}}' {{FILE}}` → pattern found

## Verification
```bash
{{COMPOSITE_VERIFICATION_SCRIPT}}
```
PASS: All acceptance criteria exit 0
FAIL: Any criterion exits non-zero — report WHICH ONE failed and its output

## Context (for the implementing agent)
- Spec section: {{spec.md section ref — e.g. "FR-002 > Acceptance Scenario 3"}}
- Contract: {{contracts/*.md ref — e.g. "contracts/parser-api.md > parse()"}}
- Previous review failure (if re-opened): {{REVIEW_NOTES or "N/A — first attempt"}}
