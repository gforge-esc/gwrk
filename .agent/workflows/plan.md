---
description: Create a technical implementation plan from a spec.
---

# /plan

**Persona**: Senior Architect
**Pillar**: Definition (Clarity)

<scope_constraints>
- Create ONLY plan.md (and optionally data-model.md, contracts/).
- Do not create tasks.json (that's /plan-to-tasks).
- Do not implement any code.
- Reference existing monorepo structure from `docs/architecture.md`.
</scope_constraints>

## Branch Discipline

> [!IMPORTANT]
> **Definitional work (specs, plans) lives on `develop`.** Feature branches are created only at `/implement` time. This keeps all specs and plans visible to each other for cross-referencing.

- Verify you are on `develop` before starting: `git rev-parse --abbrev-ref HEAD` should output `develop`.
- If not on `develop`, switch: `git checkout develop`.
- Do NOT create feature branches during `/specify` or `/plan`.

## Architecture Reference

<architecture_reference>
The plan MUST be grounded in `docs/architecture.md`:
- **Project Structure** (§2): Map features to the correct package/crate.
- **Hexagonal Registry** (§4): Adapters → Services → Ports → Infrastructure. Never violate dependency direction.
- **Forensic Guardrails** (§4): I-CR-001 (Determinism), I-CR-002 (Air-Gapped), I-CR-003 (Audit Trail).
- **Tech Stack**: Tauri v2, React 19, Tailwind v4.2, Fastify, Rust engine (napi-rs v3), SQLite (better-sqlite3).

Database Standards:
- **SQLite**: Local-first via `better-sqlite3`. WAL mode for crash safety.
- **Schema Management**: SQL migrations in `packages/database/`.
- **No ORM**: Direct SQL queries via `better-sqlite3` in `packages/core/index/`.
- **Audit Trail**: Append-only `audit_events` table. No UPDATE, no DELETE.
</architecture_reference>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/001-pipeline-setup`)

## Prerequisites

- `{feature_dir}/spec.md` exists.

## Steps

### 1. Run prerequisites check
// turbo
```bash
.specify/scripts/bash/check-prerequisites.sh --json
```
- PASS: `FEATURE_DIR` contains spec.md.
- FAIL: Stop. Run `/specify` first.

### 2. Load context

- Read `{feature_dir}/spec.md` (required).
- Read `docs/architecture.md` (required — for project structure, guardrails, tech stack).
- Read `specs/000-build-plan.md` §1 (Dependency Graph) and §3 (Critical Path) — understand upstream/downstream impacts and where this spec fits.
- Read `.agent/templates/monorepo-context.md` (required — for package map and commands).
- Read `.specify/templates/plan-template.md` (required — output skeleton).

### 2a. Cross-reference sister specs (MANDATORY)

<cross_reference_rules>
Read all existing specs and contracts to ensure plan compatibility:
```bash
ls specs/*/spec.md specs/*/contracts/*.md 2>/dev/null
```

For each spec that touches the same architectural components:
- **Read its contracts/**: Verify your planned types and APIs don’t conflict.
- **Check phase ordering**: If your plan depends on another spec’s deliverables, note the dependency explicitly.
- **Verify shared fixture/data compatibility**: If both specs touch `crates/engine/fixtures/` or `packages/domain/`, ensure schemas align.
- **Check Done When assertions**: Ensure your phase gates don’t contradict another plan’s gates.

This step is what prevents specs from being "conjured from the same source but not well coordinated."

If conflicts are found:
- **Contract type conflict**: Flag as 🔴 RED. Stop and report to user. Do NOT attempt resolution.
- **Phase ordering dependency**: Document explicitly in plan.md Deferred Items with the dependent spec reference.
- **Shared fixture incompatibility**: Flag as 🟡 AMBER. Document the discrepancy and proceed — resolution is the user’s call.
</cross_reference_rules>

### 3. Load governance context

Determine which governance rules and skills apply to this feature. Read each applicable rule file:

| If feature touches... | Read this governance rule | Applicable skills |
|---|---|---|
| UI components, styles | `.agent/rules/workspace.md` | — |
| Fixtures, test data, seeds | `.agent/rules/seeding-governance.md` | — |
| Environment variables, config | `.agent/rules/workspace.md` | — |
| `packages/domain` changes | — | `compile-gate` |
| Any code changes | — | `compile-gate` (always implicit) |

### 4. Generate plan.md

Produce `{feature_dir}/plan.md` using the template at `.specify/templates/plan-template.md`.
Fill every `{{PLACEHOLDER}}` token. Do not invent sections or skip any.

<output_rules>
- Map **every** `US-###` and `FR-###` from the spec to a phase. Unmapped items go in Deferred Items.
- Use the monorepo layout from architecture.md §2 for file paths:
  - Engine functions → `crates/engine/src/`
  - Pipeline orchestration → `packages/core/src/pipeline/`
  - SQLite index → `packages/core/src/index/`
  - Audit trail → `packages/core/src/audit/`
  - Domain types → `packages/domain/src/`
  - UI components → `packages/ui/src/`
  - Desktop shell → `apps/desktop/`
  - Web routes → `apps/web/src/routes/`
- **Phase sizing**: ≤10 file changes per phase. Split by functional boundary if larger.
- Every phase MUST have: Governance & Skills Contract, Test Strategy table, Done When section.
- **Test Strategy** maps `TR-###` to test type, target file, and executable assertion.
- **Done When** lists executable shell commands that prove the phase is complete.
- Every contract method in `contracts/` MUST be mapped to the phase that implements it.
- **Coverage Matrix** MUST account for every `US-###`, `FR-###`, `TR-###`, `TC-###`, `SC-###`, `VR-###`, `DM-###` from the spec.
- Deferred Items section MUST exist (even if "None — full coverage.").
</output_rules>

### 5. Generate `data-model.md` (if entities exist in spec)

- Define SQLite schema additions (SQL CREATE TABLE statements).
- Define Zod types for `@codered/domain`.
- Write to `{feature_dir}/data-model.md`.

### 6. Generate `contracts/` (MANDATORY if APIs or shared types exist)

- Define request/response schemas with **method-level granularity**.
- Not just type shapes — specify which service methods must exist, what they accept, what they return.
- Write to `{feature_dir}/contracts/`.

### 7. Report via notify_user

> "Plan created: {paths}. Next: `/plan-to-tasks` to generate tasks.json and verification gates."

<quality_gate>
Before reporting, verify the plan includes:
- Governance & Skills Contract for every phase
- Test Strategy table for every phase (TR-### → target → assertion)
- Done When section for every phase (executable commands)
- Type dependency graph (if shared types exist)
- Mockup-to-selector mapping (if mockups exist)
- Method-level contracts (if APIs exist)
- Contract methods mapped to phases (if contracts/ exist)
- Exact file paths for every phase
- Phase sizing ≤10 files (split if larger)
- `FR-###` references for every deliverable
- Every `US-###` from spec is assigned to a phase or listed in Deferred Items
- Every `FR-###` from spec is assigned to a phase or listed in Deferred Items
- Every `TR-###`, `DM-###`, `SC-###`, `VR-###` from spec appears in Coverage Matrix
- Coverage Matrix section exists with zero unaccounted items
- Deferred Items section exists (even if empty: "None — full coverage")

If any are missing, add them before reporting.
</quality_gate>

## Next Step

After plan is created:
- Run `/plan-to-tasks` to generate tasks.json and verification gates
- Run `/analyze` to validate cross-artifact consistency

## Anti-Patterns

- ❌ Creating tasks.md or code (those are separate workflows)
- ❌ Creating feature branches (definitional work lives on `develop`)
- ❌ Resolving contract conflicts between specs (flag as 🔴 RED and stop)
- ❌ Skipping sister spec cross-referencing (Step 2a is MANDATORY)
- ❌ Inventing template sections not in `.specify/templates/plan-template.md`
- ❌ Phases with > 10 file changes (split by functional boundary)
- ❌ Leaving unmapped US-### or FR-### items (everything goes in a phase or Deferred Items)
- ❌ Missing Governance & Skills Contract for any phase
- ❌ Ignoring `specs/000-build-plan.md` dependency graph and critical path
