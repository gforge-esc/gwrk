---
description: Generate domain-specific quality checklists that gate implementation.
---

# /checklist

**Persona**: Principal Engineer
**Pillar**: Definition (Quality Gate)

<scope_constraints>
- Generate ONLY checklist files in `specs/{feature}/checklists/`.
- Do not modify spec.md, plan.md, or any other artifact.
- Checklists test REQUIREMENTS QUALITY, not implementation behavior.
- Do not fix issues. Generate the checklist for human review.
- Every checklist item MUST reference a specific section of spec.md.
</scope_constraints>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-example-feature`)
- `domain`: Focus area — MUST be one of: `ux | api | security | data | testing | observability | config`

## Prerequisites

- `{feature_dir}/spec.md` exists.

## Steps

1. Read `{feature_dir}/spec.md` — requirements, acceptance criteria, coverage matrix.

2. Read `specs/000-build-plan.md` §9 (Forensic Guardrail Applicability) to identify which guardrails apply to this feature.

3. Generate checklist for the specified domain:
   - Create `{feature_dir}/checklists/{domain}.md`
   - Each item tests whether a requirement is well-written and verifiable

4. Checklist item format:

   <output_rules>
   - Every item MUST follow this structure:
     ```markdown
     - [ ] CHK-{NNN} — Is {requirement} specified with measurable criteria? [{dimension}] (spec.md § {section_ref})
     ```
   - `{dimension}` MUST be one of: Clarity, Coverage, Testability, Completeness, Consistency
   - `(spec.md § {section_ref})` MUST reference the specific spec section being checked
   - Items MUST be grouped by verification dimension (see below)
   - Minimum 3 items per applicable dimension
   - Maximum 30 items total per domain checklist
   </output_rules>

5. Mandatory verification dimensions (per workspace/coding-style rules):

   <verification_dimensions>
   - **Testing** (CRITICAL):
     - Are unit test requirements (TR-###) specified **in spec.md**, not just plan.md?
     - Is E2E verification (Playwright) **explicitly required** for all user-facing flows?
     - ⚠️ **E2E is NOT optional** — mark as CRITICAL gap if missing
   - **State Synchronization** (CRITICAL for frontend specs):
     - Is frontend-to-backend ID reconciliation specified?
     - Are component identity requirements (React `key` props) defined for forms?
   - **Seed Data Integrity** (CRITICAL for specs with fixtures):
     - Must seed data pass Zod schema validation?
     - Do E2E tests run against fresh `db:seed` data?
   - **Observability**: Are logging, metrics, and error tracking requirements defined?
   - **Config Hygiene**: Are all config values externalized (no magic values, no defaults)?
   - **Error Handling**: Are failure states, validation errors, and edge cases specified?
   - **Docker Verification**: Is `make up` verification explicitly required for handoff?
   </verification_dimensions>

6. Report via notify_user:
   > "Checklist created: {path}. {N} items across {M} dimensions. Next: /implement (blocked until checklist passes)."

<quality_gate>
Before reporting, verify the checklist passes ALL checks:

- Every CHK-### item references a specific section of spec.md
- Every item has a `[{dimension}]` tag
- Items are grouped by verification dimension
- At least one CRITICAL-dimension item exists (Testing or State Sync or Seed Data)
- Domain argument matches one of the valid enum values
- No duplicate items (same check on same spec section)
- Total items ≤ 30

If any check fails, fix the checklist before reporting. Do NOT defer.
</quality_gate>

## Example Checks

✅ **Testing** (CRITICAL BLOCKER):
- "Are Testing Requirements (TR-###) specified **in spec.md** (not just plan.md)?" [Completeness] (spec.md § Testing Requirements)
- "Is E2E verification (Playwright) **explicitly mandated** for all user flows?" [Testability] (spec.md § TR-003)
- "Are state synchronization tests required for frontend stores with optimistic updates?" [Coverage] (spec.md § FR-003)

✅ **Observability**:
- "Are error logs with correlation IDs required for all failure states?" [Coverage] (spec.md § Error States)
- "Are metrics endpoints/dashboards specified for monitoring?" [Completeness] (spec.md § Non-Functional)

✅ **Config Hygiene**:
- "Are all URLs, ports, and timeouts externalized to env vars?" [Consistency] (spec.md § TC-003)
- "Is fail-fast validation required for missing config at startup?" [Testability] (spec.md § TC-003)

## Anti-Patterns

- ❌ Generating items without a spec.md section reference (every item must be traceable)
- ❌ Using free-text domain values (must be from the enum: `ux | api | security | data | testing | observability | config`)
- ❌ Generating > 30 items (prioritize by severity)
- ❌ Checking implementation behavior (checklists test requirement QUALITY, not code)
- ❌ Skipping CRITICAL dimensions when they apply (Testing is always applicable)
- ❌ Prose-only items without `[{dimension}]` classification

## Next Step

After checklist is created, user should:
1. Review and check items `[x]` as requirements are clarified
2. Run `/implement` (blocked if checklist items remain unchecked)
