---
description: Generate red test files from spec, plan, and contracts before implementation begins.
---

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

> **Core principle**: The agent writing tests has no motivation to make them easy.
> The agent writing code has no authority to change them.

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)
- `phase_number`: Phase to generate tests for (e.g., `2`)

## Prerequisites

- `{feature_dir}/spec.md` exists with TR-### section
- `{feature_dir}/plan.md` exists with phase structure and Governance & Skills Contract
- Contracts in `{feature_dir}/contracts/` (if APIs or shared types exist)

## Algorithm

### 1. Load Context (Deep Read)

Read and understand the feature and phase deeply:

- `{feature_dir}/spec.md` — TR-###, FR-###, US-### with acceptance scenarios
- `{feature_dir}/plan.md` — Phase {N} file paths, type dependency graph, contracts
- `{feature_dir}/contracts/` — method-level request/response schemas
- `{feature_dir}/data-model.md` — entity shapes (if exists)
- `docs/architecture.md` — project structure, tech stack, test conventions

### 2. Map Requirements to Test Types

Derive test file locations from `plan.md`'s file structure and `docs/architecture.md`'s project layout.
Co-locate tests as `<module>.test.ts` adjacent to their source file.

<test_type_mapping>
| TR Category | Test Framework | File Location |
|---|---|---|
| Unit tests | Vitest | Co-located `<module>.test.ts` |
| Integration (API) | Vitest + server inject | Co-located with route handler |
| E2E (UI flows) | Playwright | `e2e/*.spec.ts` |
| Docker/infra verification | Shell | Covered by gates — skip here |
</test_type_mapping>

### 3. Generate Unit Tests

For each FR-### assigned to this phase in `plan.md`:

a. **Identify the target file** from the plan's file structure
b. **Read the contract** (if exists) for method signatures, input/output schemas
c. **Create the test file** adjacent to the source (e.g., `src/foo/bar.ts` → `src/foo/bar.test.ts`)

d. **Test content rules**:

   <output_rules>
   - Import the module under test (even though it doesn't exist yet — this makes it RED)
   - `describe` blocks MUST use `FR-###` IDs as labels
   - `it`/`test` blocks MUST map to US-### acceptance scenarios
   - Assert against contract-defined return shapes (Zod `.parse()` for TS)
   - Include ≥1 negative path (invalid input, missing field) per `describe`
   - Include boundary conditions from the spec's error states table
   </output_rules>

### 4. Generate Integration Tests (if API routes in phase)

For each API route defined in contracts:

- Use Fastify `inject()` for HTTP-level testing
- Assert status codes, response shapes, and error formats
- Test authentication/authorization if RP-### applies

### 5. Generate E2E Tests (if UI components in phase)

For each US-### with a user-facing flow in this phase:

- Create Playwright spec: `e2e/{feature-slug}-phase-{N}.spec.ts`
- Map each acceptance scenario to a `test()` block
- Use selectors from plan.md's mockup-to-selector mapping (if exists)
- Assert visible text, element existence, navigation outcomes
- Include error state tests from the spec



<red_validation_rules>
After generating all test files:

```bash
# Tests should compile but FAIL
pnpm test --run 2>&1 | tail -20
# Expected: test failures (imports that don't resolve, assertions that fail)
# If ALL tests pass: CRITICAL — tests are trivial, flag and revise
```

- If tests pass → they're hollow. **Revise with stronger assertions.**
- If tests fail to compile → acceptable for RED. Module doesn't exist yet.
- If tests compile but fail assertions → ideal RED state.
</red_validation_rules>

### 7. Write Gap Matrix

**MANDATORY OUTPUT.** Write `{feature_dir}/gap-matrix.md` — a coverage matrix mapping every requirement to its test file.

Format:
```markdown
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Plugin manifest validation | unit | src/plugins/manifest.test.ts | ✅ | T001 |
| FR-002 | Plugin loader resolution | unit | src/plugins/loader.test.ts | ✅ | T002 |
| US-001 | User registers a plugin | integration | src/commands/plugin.test.ts | ✅ | T003 |
```

Rules:
- One row per FR-###, US-###, or TR-### in this phase
- Test Exists = ✅ if the test file was created, ❌ if deferred
- Gate column left empty (filled by `define tasks`)
- Every row with ❌ must have a comment explaining why it was deferred

> [!CAUTION]
> If this file is not written, `define tests` will fail with exit code 2.
> `define tasks` will refuse to run without it.

### 8. Commit RED Tests

```bash
git add -A
git commit -m "test: red tests for Phase {phase_number} — {N} unit, {M} integration, {K} e2e"
```

### 9. Report

Report via notify_user:
```
Red tests committed for Phase {phase_number}:
  Unit:        {N} test files ({X} test cases)
  Integration: {M} test files ({Y} test cases)
  E2E:         {K} test files ({Z} test cases)

Coverage:
  FR-### mapped: {count}/{total}
  US-### mapped: {count}/{total}
  TR-### mapped: {count}/{total}

Status: RED (all tests expected to fail pre-implementation)
Next: /implement {feature_dir} {phase_number}
```

<quality_gate>
Before reporting, verify:

- Every FR-### in this phase has ≥1 test case
- Every US-### acceptance scenario in this phase has ≥1 test assertion
- Every contract method has ≥1 integration test (if API phase)
- Negative/error paths tested (not just happy path)
- Tests reference actual module paths from plan.md (not placeholder imports)
- No test passes before implementation (RED check)
</quality_gate>

## Anti-Patterns

- ❌ Writing production code (only test files)
- ❌ Tests that assert `true` or check only status codes
- ❌ Tests without spec traceability (every `describe`/`it` maps to FR/US/TR)
- ❌ Skipping negative paths (error states, invalid input, missing config)
- ❌ Tests that pass before implementation (hollow tests)
- ❌ Generating tests for deferred TR-### items

## Next Step

After red tests are committed:
- Run `/implement {feature_dir} {phase_number}` to turn them green
- `/review-code` will verify both gate results AND test results
