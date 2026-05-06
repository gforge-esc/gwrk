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

### 6. Reconcile Existing Tests (Test Lifecycle — MANDATORY)

Before writing new tests, detect and handle orphaned tests from previous phases or refactors:

```bash
# Find tests referencing files/scripts that no longer exist
for tf in $(find src/ -name '*.test.ts' -not -path '*/node_modules/*'); do
  # Extract file references from import/require/path.join patterns
  refs=$(grep -oE '(scripts|src)/[^"'\''\)\s,]+' "$tf" 2>/dev/null | sort -u)
  for ref in $refs; do
    if [[ ! -f "$ref" && ! -d "$(dirname "$ref")" ]]; then
      echo "ORPHAN: $tf references missing: $ref"
    fi
  done
done

# Find tests marked .skip or .todo without a tracking reason
grep -rn '\.skip\|\.todo' src/**/*.test.ts 2>/dev/null | grep -v 'DEPRECATED\|TODO:' || true
```

For each orphaned test:
1. **If replacement coverage exists** in a new test file for the same FR-### → **DELETE** the orphan
2. **If no replacement coverage exists** → **FLAG** as coverage gap in gap-matrix.md
3. **If the test targets deprecated infrastructure** → **DELETE** with `git rm` and record the reason

> [!CAUTION]
> Tests that reference deleted files are **ghost tests** — they can't pass, they can't fail
> meaningfully, and they silently poison the suite. Ghost tests MUST be retired, not `.skip`'d.
> A `.skip` is a temporary bridge (max 1 sprint). Permanent skips are coverage lies.

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
- ❌ Leaving ghost tests (`.skip` with no plan to delete or migrate)
- ❌ Writing async tests that rely on `setTimeout` instead of `vi.waitFor()`
- ❌ Testing self-scheduling systems without controlling the scheduler

## Next Step

After red tests are committed:
- Run `/implement {feature_dir} {phase_number}` to turn them green
- `/review-code` will verify both gate results AND test results
