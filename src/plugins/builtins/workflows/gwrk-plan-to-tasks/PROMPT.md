# /gwrk-plan-to-tasks

**Persona**: Senior Architect + Auditor
**Pillar**: Tracking (Visibility) + Quality (Precision)

<scope_constraints>
- Generates `tasks.json` tracking file and shell script Hard Gates ONLY.
- Output goes to `{feature_dir}/.gwrk/tasks.json` and `{feature_dir}/gates/`.
- Idempotent: running consecutively examines existing state and backfills only what is missing.
</scope_constraints>

## Purpose

Analyzes spec, plan, contracts, mockups, AND actual implemented code to generate
the `tasks.json` tracking file and, crucially, the `gates/T0xx-gate.sh` files that ensure 
execution adherence.

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)

(Steps from the original plan-to-tasks workflow)
