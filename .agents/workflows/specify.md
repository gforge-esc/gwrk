---
description: Create a feature specification from a natural language description.
---

# /specify

**Persona**: Product Manager
**Pillar**: Definition (Clarity)

<scope_constraints>
- Create ONLY the spec.md file from the feature description.
- Do not create plan.md or tasks.md (those are separate workflows).
- Do not implement any code.
- Ask clarifying questions until all acceptance criteria have executable assertions. Prefer multiple-choice or ≤5-word answers.
</scope_constraints>

## Branch Discipline

> [!IMPORTANT]
> **Definitional work (specs, plans) lives on `develop`.** Feature branches are created only at `/implement` time when code isolation is needed. This keeps all specs visible to each other, enabling cross-referencing and compatibility checking.

- Verify you are on `develop` before starting: `git rev-parse --abbrev-ref HEAD` should output `develop`.
- If not on `develop`, switch: `git checkout develop`.
- Do NOT create feature branches during `/specify` or `/plan`.

## Architecture Reference

Before specifying, load these files for context:
- `docs/architecture.md` — Project Structure (§2), Forensic Guardrails (§4), Hexagonal Registry (§4), Tech Stack.
- `specs/000-build-plan.md` — Dependency graph (§1), Spec Register (§2), Execution Order (§8), Forensic Guardrail Matrix (§9). Understand where this spec fits in the overall MVP.

## Relational Handshake Mandate
- When specifying engine features, ensure SHA256 determinism requirements are explicit.
- When specifying data features, emphasize full relational fidelity.
- Ensure requirements cover identity synchronization between desktop forensic states and server-validated identities.

## Inputs

- `feature_description`: Natural language description of the feature.

## Steps

1. Generate a 2-4 word kebab-case slug from the description.
   Example: "deterministic engine" → `deterministic-engine`

2. Find highest feature number in `specs/` and increment.
   ```bash
   ls specs/ | grep -E '^[0-9]+' | sort -n | tail -1
   ```

3. **Clarify ambiguities** (if needed):

   <clarification_protocol>
   - If requirements lack executable acceptance criteria, ask targeted questions
   - Each question should be answerable with multiple choice or ≤5 words
   - Continue until every acceptance scenario has a verifiable assertion command
   - Stop after 3 rounds of clarification, OR when all acceptance scenarios have shell assertions, whichever comes first
   - If ambiguity remains after 3 rounds, document it as an open question and proceed
   - Wait for user response before proceeding
   </clarification_protocol>

4. Create feature scaffold:
   // turbo
   ```bash
   .specify/scripts/bash/create-new-feature.sh --json "{feature_description}" --number {N} --short-name "{slug}"
   ```
   - PASS: JSON output contains `SPEC_FILE` path. No branch is created.
   - FAIL: Stop. Report error.

5. **Cross-reference existing specs** (MANDATORY but bounded):

   <cross_reference_rules>
   Read specs that share the **same Arch Phase or PRD FR** as this spec (check `specs/000-build-plan.md` §2 for mappings). Skip unrelated specs.
   ```bash
   ls specs/*/spec.md 2>/dev/null
   ```
   For each relevant spec that shares:
   - PRD functional requirements (FR-###)
   - Architectural components (`crates/engine/`, `packages/core/`, etc.)
   - Domain types or contracts

   Read the spec and its `contracts/` directory. Check for:
   - **Shared type compatibility**: Do your types align with existing contracts?
   - **Conflicting FR implementations**: Does your spec redefine something another spec owns?
   - **Assertion conflicts**: Do acceptance scenarios contradict existing specs?
   - **Dependency ordering**: Does your spec depend on another spec's deliverables?

   If conflicts are found, adjust the spec or note the dependency explicitly.
   </cross_reference_rules>

6. **Fill specification** using the template at `.specify/templates/spec-template.md`.
   Fill every `{{PLACEHOLDER}}` token. Do not invent sections or skip any.

   <output_rules>
   - Every `US-###` MUST use consistent format (hyphenated, zero-padded). Sub-stories use dot notation: `US-006a`, `US-006b`.
   - Every acceptance scenario **Then** clause MUST include an executable shell assertion command — not prose.
   - Every `FR-###` MUST back-reference ≥1 `US-###` it fulfills.
   - Every `TR-###` MUST be **feature-specific**: name the target file/module and what to assert. If a test type doesn't apply, mark `DEFERRED` with rationale.
   - Every FR with failure modes MUST have an `Error States` table (condition, stderr, exit code).
   - Technical Constraints (TC-001, TC-002, TC-003) are CodeRed invariants — include them always, add feature-specific TCs as needed.
   - Coverage matrix MUST include the `Tested by TR` column. Every FR MUST map to ≥1 TR (or `no test — rationale`).
   </output_rules>

7. Write to `specs/{feature}/spec.md`.

8. Create `specs/{feature}/checklists/requirements.md` using template.

9. Report via notify_user:
   > "Spec created: {path}. Next: `gwrk define plan <feature>` to create implementation plan."

<quality_gate>
Before reporting, verify the spec passes ALL checks:

- Every user story has a `US-###` ID
- Every FR has a `FR-###` ID
- Every US maps to ≥1 FR (no orphaned stories)
- Every FR maps to ≥1 US (no orphaned requirements)
- Every FR maps to ≥1 TR in coverage matrix (or marked `no test — rationale`)
- Every acceptance scenario **Then** clause has an executable assertion command
- Testing Requirements (TR-###) are **feature-specific** (not template boilerplate)
- Error States defined for FRs with failure modes
- Coverage matrix has zero orphans
- No sub-stories without parent reference (US-006a must reference US-006)

If any check fails, fix the spec before reporting. Do NOT defer to `/checklist`.
</quality_gate>

## Next Step

After spec is created:
- Run `gwrk define plan <feature>` to create technical implementation plan
- Or run `gwrk define <feature>` for full DUS loop (spec → plan → tasks → analyze)

## Validation: Missing TR Requirements

If the spec is created WITHOUT Testing Requirements (TR-###):
- The DUS `analyze` stage will flag this as a **CRITICAL** coverage issue
- **Implementation is BLOCKED** until Testing Requirements are added

## Anti-Patterns

- ❌ Reading ALL specs for cross-referencing (read only those sharing same Arch Phase or PRD FR)
- ❌ Creating plan.md or tasks.md (those are separate workflows)
- ❌ Implementing any code during specification
- ❌ Creating feature branches (definitional work lives on `develop`)
- ❌ Proceeding past 3 rounds of clarification without documenting remaining ambiguity
- ❌ Inventing template sections not in `.specify/templates/spec-template.md`
- ❌ Writing acceptance criteria as prose instead of shell assertions
- ❌ Skipping the coverage matrix or leaving orphaned FR/US items
- ❌ Ignoring `specs/000-build-plan.md` forensic guardrail applicability (§9)
