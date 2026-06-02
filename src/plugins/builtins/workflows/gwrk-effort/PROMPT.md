---
description: Perform effort assessment using Story Points as the primary estimation basis, with hours derived per role.
---

# Workflow: Effort Assessment (/effort)

This workflow produces a **Story Point–driven effort estimate** for gwrk work. Story Points (SP) are the primary unit of scope. Hours and days are **derived** from SP via role-specific multipliers — never the other way around.

<scope_constraints>
- Generate ONLY the effort assessment report. Do not modify specs, plans, or code.
- SP is the primary unit. Hours are derived, never estimated directly.
- LOC/LOS metrics are validation only — never use them to derive estimates.
- Output goes to `docs/assessments/effort-YYYY-MM-DD.md`.
</scope_constraints>

## Principles

1. **SP is the atom.** Every user story in a spec gets an SP value. Hours are a function of SP × role rate.
2. **Role bracketing.** Every story is assigned to one or more roles. The role determines the hours-per-SP multiplier.
3. **LOC/LOS are validation.** Line counts may be used to sanity-check estimates after the fact, but never to derive them.

---

## Roles & Multipliers

Each role has an **hours-per-SP rate** reflecting the nature of their contribution. Rates assume a standard 8-hour day.

[type: gwrk-native]
| Role | Code | Activity | Hours/SP | Notes |
| :--- | :--- | :--- | ---: | :--- |
| **Rust / Engine Engineer** | `RE` | Engine implementation (parser, diff, normalization, fingerprinting, hashing, PDF) | **6** | High-complexity systems work in Rust; Tree-sitter, napi-rs, deterministic compute |
| **TS / Fullstack Developer** | `TS` | Pipeline orchestration, UI components, web surfaces, SQLite integration | **4** | Standard TypeScript: React, Fastify, better-sqlite3, Vitest |
| **Product Manager** | `PM` | Spec authoring, story definition, UAT, acceptance testing | **2** | Definition + validation; lower per-SP because PM work front-loads |
| **Principal Engineer** | `PE` | Architecture review, code review, guardrail enforcement, cross-spec integration | **1.5** | Oversight role; high leverage, lower direct hours per SP |
| **Data / Generator Engineer** | `DE` | Synthetic data generation, mutation operators, ground-truth manifests, calibration | **5** | Algorithmic complexity: AST transforms, deterministic generation, test corpus |
[/type]

[type: generic]
| Role | Code | Activity | Hours/SP | Notes |
| :--- | :--- | :--- | ---: | :--- |
| **Senior Engineer** | `SE` | Feature implementation and unit testing | **4** | Standard development role |
| **Product Manager** | `PM` | Requirements definition and UAT | **2** | Design and validation |
| **QA Engineer** | `QA` | Test planning and automation | **3** | Quality assurance |
[/type]

> [!IMPORTANT]
> **Overlap rule:** When a story requires multiple roles, each role's hours are calculated independently and summed. A 5 SP story assigned to `RE + TS` = (5 × 6) + (5 × 4) = 50 hours. Use fractional SP splits when contribution is unequal (e.g., RE: 3 SP, TS: 2 SP).

---

## Steps

### 1. Extract Story Inventory

Pull all user stories from `specs/000-build-plan.md` §5 (Story Point Coverage) and each spec's story definitions. For each story, record:

- Story ID
- Description
- SP value
- Assigned Spec(s)
- Primary Role(s) (`RE`, `TS`, `PM`, `PE`, `DE`)

### 2. Bracket Stories by Role

Assign each story and each spec to its primary execution role(s):

[type: gwrk-native]
| Domain | Primary Role | Supporting Role |
| :--- | :--- | :--- |
| Engine Foundation, AST Diff, Normalization, Comment Provenance | `RE` | `PE` |
| Core Orchestration, SQLite/Audit, Pipeline wiring | `TS` | `PE` |
| Exhibit A Workspace, Exhibit B/C, UI components | `TS` | `PE` |
| Scorecard & Metrics | `TS` + `RE` | `PE` |
| Agentic Filtering | `TS` | `PE` |
| Licensing & Identity | `RE` + `TS` | `PE` |
| Seed/Scaffold, Mutations, Fingerprints, Ground-Truth, Discriminator | `DE` + `RE` | `PE` |
| Labs Portal | `TS` | `PE` |
| CI/CD | `TS` | `PE` |
| Demo Tier | `TS` | `PM` |
| All specs (definition phase) | `PM` | — |
| All specs (review phase) | `PE` | — |
[/type]

[type: generic]
Assign each story to its primary execution role(s) based on the project's domains and roles.
[/type]

### 3. Calculate Hours from SP

For each spec or story:

```
Role Hours = SP × Hours/SP rate (from table above)
```

Sum across all roles for total hours per spec and grand total.

### 4. Calculate Overhead Multiplier

Apply a **1.25× overhead factor** to raw hours to account for:
- Git workflow and PR process
- CI debugging and cross-platform fixes
- Spec revision cycles
- Integration between workstreams

### 5. Convert to Days

```
Days = Hours ÷ 8
```

### 6. (Optional) LOC/LOS Validation

If desired, run `cloc` metrics as a sanity check against SP-derived estimates:

[type: gwrk-native]
```bash
# Definition metrics
cloc specs docs --include-lang=Markdown --json

# Shipment metrics
cloc apps packages crates \
  --exclude-dir=node_modules,dist,.turbo,vendor,out,build,target \
  --include-lang="TypeScript,TSX,Rust,CSS,HTML" \
  --json
```
[/type]

[type: generic]
Run LOC metrics on the project's source and documentation directories as a sanity check.
[/type]

Compare: if LOC-implied hours diverge >30% from SP-implied hours, investigate.

---

## Report Template

Generate the report as `docs/assessments/effort-YYYY-MM-DD.md`:

```markdown
# Effort Assessment: [Target Name]
**Date**: YYYY-MM-DD
**Basis**: Story Points (primary) · Hours derived via role multipliers

## Executive Summary
- **Total Story Points**: [SP]
- **Total Estimated Hours (raw)**: [H]
- **Total Estimated Hours (with 1.25× overhead)**: [H]
- **Estimated Person-Days (8h)**: [D]

## Methodology & Validation
SP-derived estimates using role-specific Hours/SP rates per /effort workflow.
**Validated by [AUTHOR].**

## Role Summary
| Role | SP Assigned | Raw Hours | With Overhead | Days |
| :--- | ---: | ---: | ---: | ---: |
[type: gwrk-native]
| Rust / Engine Engineer | [SP] | [H] | [H] | [D] |
| TS / Fullstack Developer | [SP] | [H] | [H] | [D] |
| Product Manager | [SP] | [H] | [H] | [D] |
| Principal Engineer | [SP] | [H] | [H] | [D] |
| Data / Generator Engineer | [SP] | [H] | [H] | [D] |
[/type]
[type: generic]
| Senior Engineer | [SP] | [H] | [H] | [D] |
| Product Manager | [SP] | [H] | [H] | [D] |
| QA Engineer | [SP] | [H] | [H] | [D] |
[/type]
| **Total** | **[SP]** | **[H]** | **[H]** | **[D]** |

## Spec-Level Breakdown
| Spec | Name | SP | Roles | Raw Hours | With Overhead |
| :--- | :--- | ---: | :--- | ---: | ---: |
| 001 | Monorepo Scaffold | — | — | — | — |
| 002 | Engine Foundation | [SP] | RE, PE | [H] | [H] |
| ... | ... | ... | ... | ... | ... |

## Story Point Breakdown by Priority
- P0 (Must Have): [SP] SP
- P1 (Should Have): [SP] SP
- P2 (Nice to Have): [SP] SP

## Workstream Totals
| Workstream | Specs | SP | Raw Hours | With Overhead | Days |
| :--- | :--- | ---: | ---: | ---: | ---: |
| Core Engine | 002–015 | [SP] | [H] | [H] | [D] |
| Synthetic Generator | 016–021 | [SP] | [H] | [H] | [D] |

## Risk Factors & Assumptions
- [List key risks, unknowns, and assumptions]
```

<quality_gate>
Before reporting, verify:
- All stories are assigned to at least one role
- Hours are derived from SP × role rate — never from LOC
- Overhead multiplier is applied
- Report includes per-spec breakdown, per-role summary, and per-workstream totals
- Optional LOC/LOS validation included as appendix if run
</quality_gate>
