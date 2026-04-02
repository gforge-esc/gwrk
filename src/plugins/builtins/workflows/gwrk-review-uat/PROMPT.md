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

(Steps from the original review-uat workflow)
