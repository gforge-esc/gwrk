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

(Steps from the original review-code workflow)
