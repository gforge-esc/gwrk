---
description: Generate red test files from spec, plan, and contracts before implementation begins.
---

# /gwrk-define-tests

**Persona**: QA Architect
**Pillar**: Definition (Quality Gate)

<scope_constraints>
- Generate ONLY test files. Do not implement production code.
- Tests MUST fail (RED). A compilation/import error for missing functions is a perfectly valid RED state. If a test passes before implementation, it is trivial — flag it.
- Output goes to the standard test locations in the monorepo.
- Do NOT run `/implement`. This workflow ends with committed red tests.
- A separate agent runs `/implement` to turn them green.

<file_write_guardrail>
**FILE WRITE GUARDRAIL — ABSOLUTE RULE**

There are TWO categories of actions, with different safety levels:

**SAFE actions (proceed without hesitation):**
- CREATE a new `*.test.ts` file that does not yet exist
- CREATE or UPDATE `gap-matrix.md`
- CREATE or UPDATE files in `contracts/`
- ADD new `describe`/`it` blocks to an EXISTING test file that ONLY contains RED stubs (`throw new Error('Not implemented')`)

**UNSAFE actions (PROHIBITED — will destroy production work):**
- OVERWRITE an existing `*.test.ts` file that contains working test implementations (mocks, assertions, setup/teardown logic beyond `throw new Error`)
- DELETE or REPLACE existing `describe`/`it` blocks that have real assertion logic
- MODIFY any production source file (`*.ts` without `.test.`) — this includes `src/db/*.ts`, `src/server/*.ts`, `src/commands/*.ts`, `src/engine/*.ts`, `src/utils/*.ts`

**MANDATORY PRE-WRITE CHECK — Execute this BEFORE writing any test file:**
```bash
# Step 1: Check if the file exists
if [ -f "$TEST_FILE" ]; then
  # Step 2: Count lines that are NOT imports, describes, or throw stubs
  IMPL_LINES=$(grep -cvE '^(import |describe|it\(|throw new Error|expect\(.*\)\.toBeDefined|\s*\}|\s*\)|\s*$)' "$TEST_FILE")
  if [ "$IMPL_LINES" -gt 5 ]; then
    echo "BLOCKED: $TEST_FILE has $IMPL_LINES lines of implementation. APPEND ONLY."
    # DO NOT OVERWRITE. Only APPEND new describe/it blocks for missing FRs.
  fi
fi
```

If the file exists and has working implementations:
1. READ the existing file first
2. IDENTIFY which FR-###/US-### are already covered
3. APPEND only the MISSING test cases as new `describe`/`it` blocks
4. Do NOT reorganize, rename, or restructure existing blocks

<compliant_example>
**COMPLIANT**: File `src/db/runs.test.ts` exists with 179 lines of working tests covering FR-014, FR-015.
Phase 5 needs tests for FR-H03. Agent APPENDS a new `describe('FR-H03: ...')` block at the end.
Existing 179 lines are untouched.

**NON-COMPLIANT**: Agent replaces the entire file with 13 lines of `throw new Error('Not implemented')` stubs.
This destroys 179 lines of working tests. This is a FIRING OFFENSE.
</compliant_example>

If a test needs a type or function that doesn't exist yet, import it anyway and let it fail to compile.
A compilation error IS the RED signal — that's honest. Replacing the production file with a stub is DESTRUCTIVE.
If you need shared test helpers (mocks, factories), create them in a `__test-support__/` directory
alongside the test file, NEVER by modifying the production module.
</file_write_guardrail>
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

<async_test_guidance>
### Async State Machine Testing

For event-driven or self-scheduling systems (dispatch queues, orchestrators, WebSocket handlers):

1. **Mock the scheduler, not just the inputs.** If the system under test calls `processNext()` internally, inject a throttle/gate after the first invocation to create a deterministic assertion window.
2. **Use `vi.waitFor()` with specific state assertions**, not timing-based `setTimeout` waits.
3. **Never rely on automatic scheduling order** — if `enqueue()` triggers `processNext()` which triggers `handleCompletion()` which triggers `processNext()` again, the assertion window between state transitions is a microtask boundary. Tests MUST control when the next tick fires.
4. **Prefer mock-resolved-value-once** over manual state manipulation — let the system exercise its own state transitions rather than calling internal methods directly.
5. **Test the state machine diagram, not the happy path** — assert on intermediate states (queued → running → retrying), not just the final state.

Example pattern for self-scheduling queues:
```typescript
// BAD: race between handleCompletion's processNext() and assertion
const record = queue.enqueue(request);
await sleep(50);
expect(record.status).toBe("retrying"); // ← might already be "running" again

// GOOD: throttle after first attempt to freeze state
mockMonitor.isThrottled.mockImplementation(() => attemptCount++ > 1);
const record = queue.enqueue(request);
await vi.waitFor(() => {
  if (record.status !== "retrying") throw new Error("Not retrying yet");
});
expect(record.status).toBe("retrying"); // ← deterministic
```
</async_test_guidance>

<red_validation_rules>
After generating all test files:

```bash
# Tests should fail (compilation errors are expected and acceptable)
pnpm test --run 2>&1 | tail -20
# Expected: test failures (imports that don't resolve, assertions that fail)
# If ALL tests pass: CRITICAL — tests are trivial, flag and revise
```

- If tests pass → they're hollow. **Revise with stronger assertions.**
- If tests fail to compile → acceptable for RED. Module doesn't exist yet.
- If tests compile but fail assertions → ideal RED state.
</red_validation_rules>

### 6. Write Gap Matrix

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
- Gate column: leave empty — `define tasks` auto-populates it by matching test files to task primary files via `generateVitestGates()`
- Every row with ❌ must have a comment explaining why it was deferred

> [!CAUTION]
> If this file is not written, `define tests` will fail with exit code 2.
> `define tasks` will refuse to run without it.

### 7. Report

Report via notify_user:
```
Red tests generated for Phase {phase_number}:
  Unit:        {N} test files ({X} test cases)
  Integration: {M} test files ({Y} test cases)
  E2E:         {K} test files ({Z} test cases)

Coverage:
  FR-### mapped: {count}/{total}
  US-### mapped: {count}/{total}
  TR-### mapped: {count}/{total}

Status: RED (all tests expected to fail pre-implementation)
Next: Orchestrator will commit changes. Then run /implement {feature_dir} {phase_number}
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
- ❌ Leaving ghost tests (`.skip` with no plan to delete or migrate)
- ❌ Writing async tests that rely on `setTimeout` instead of `vi.waitFor()`
- ❌ Testing self-scheduling systems without controlling the scheduler
- ❌ **OVERWRITING existing test files that have working implementations** — APPEND new blocks only
- ❌ **Replacing 100+ lines of working test code with stub `throw new Error` blocks** — this is destruction, not definition

## Next Step

After red tests are committed:
- Run `/implement {feature_dir} {phase_number}` to turn them green
- `/review-code` will verify both gate results AND test results

<critical_instruction_repeat>
**REMINDER — HIGHEST PRIORITY RULE (repeated for long-context adherence):**
NEVER overwrite an existing test file that contains working implementations.
If a test file exists and has real mocks, assertions, setup/teardown logic:
→ READ it first, IDENTIFY missing coverage, APPEND new blocks only.
Violation of this rule destroys production-tested code and is treated as a critical failure.
</critical_instruction_repeat>
