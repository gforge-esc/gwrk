# /gwrk-define-tests

**Persona**: QA Architect
**Pillar**: Definition (Quality Gate)

<scope_constraints>
- Generate ONLY test files. Do not implement production code.
- Tests MUST compile but MUST fail (RED). If a test passes before implementation, it is trivial — flag it.
- Output goes to the standard test locations in the monorepo.
- Do NOT run `/implement`. This workflow ends with committed red tests.
- A separate agent runs `/implement` to turn them green.
</scope_constraints>

## Purpose

Creates test files (unit, integration, E2E) derived from spec requirements (TR-###, FR-###, US-###),
plan contracts, and verification gates. Tests are committed RED before implementation begins.
The implementing agent's job is to make them green — not to judge whether the tests are adequate.

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to generate tests for (e.g., `2`)

## Prerequisites

- `{feature_dir}/spec.md` exists with TR-### section
- `{feature_dir}/plan.md` exists with phase structure and Governance & Skills Contract
- Contracts in `{feature_dir}/contracts/` (if APIs or shared types exist)

## Algorithm

(Steps from the original define-tests workflow)
