# /gwrk-plan

**Persona**: Senior Architect
**Pillar**: Definition (Clarity)

<scope_constraints>
- Create ONLY plan.md (and optionally data-model.md, contracts/).
- Do not create tasks.json (that's `gwrk define tasks`).
- Do not implement any code.
- Reference existing project structure from `docs/architecture.md`.
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
- **Project Structure** (§2): Map features to the correct source directory.
- **Tech Stack** (§4): TypeScript CLI (Commander.js), Fastify server, SQLite (better-sqlite3), Vitest, Biome.
- **Foxtrot Charlie Pillars**: Discovery, Definition, Shipping, Delivery — commands align to pillars.
- **Agent-Native Contract** ([ADR-004](docs/decisions/ADR-004-agent-native-output.md)): Every command emits `[exit:N | Xs]` on stderr. `--format json` is independent. `--agent` activates Layer 2 protections.

Source Layout:
- CLI entry + Commander routing → `src/cli.ts`
- Command handlers → `src/commands/`
- Business logic + discovery → `src/engine/`
- Build server + dispatch → `src/server/`
- Shared utilities (exec, config, state, signal, output) → `src/utils/`
- SQLite schema + queries → `src/db/`
- Zod schemas → co-located with consumers

Database Standards:
- **SQLite**: Local-first via `better-sqlite3`. WAL mode.
- **Schema Management**: SQL migrations in `src/db/migrations/`.
- **No ORM**: Direct SQL queries.
- **DB Access Constraint**: `gwrk project discover` and all discovery commands MUST work without SQLite access (repository-only). Build-server commands that need SQLite MUST fail fast if unavailable.

Decisions:
- [ADR-001](docs/decisions/ADR-001-task-tracking.md) — Gate architecture
- [ADR-002](docs/decisions/ADR-002-sqlite-execution-ledger.md) — SQLite execution ledger
- [ADR-003](docs/decisions/ADR-003-state-contract.md) — Execution state contract
- [ADR-004](docs/decisions/ADR-004-agent-native-output.md) — Agent-native output protocol
</architecture_reference>

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/013-agent-native-interface`)

## Prerequisites

- `{feature_dir}/spec.md` exists.

## Steps

### 1. Run prerequisites check
// turbo
```bash
.specify/scripts/bash/check-prerequisites.sh --json
```
- PASS: `FEATURE_DIR` contains spec.md.
- FAIL: Stop. Run `gwrk define spec <feature>` first.

### 2. Load context

- Read `{feature_dir}/spec.md` (required).
- Read `docs/architecture.md` (required — for project structure, tech stack).
- Read `specs/000-build-plan.md` §Dependency Graph and §Critical Path — understand upstream/downstream impacts and where this spec fits.
- Read `docs/reference/agent-native-cli.md` (required — for agent-native design imperatives and command surface).
- Read `docs/decisions/ADR-004-agent-native-output.md` (required — for output protocol contract).
- Read `.specify/templates/plan-template.md` (required — output skeleton).

### 2a. Cross-reference sister specs (MANDATORY)

<cross_reference_rules>
Read all existing specs and contracts to ensure plan compatibility:
```bash
ls specs/*/spec.md specs/*/contracts/*.md 2>/dev/null
```

For each spec that touches the same architectural components:
- **Read its contracts/**: Verify your planned types and APIs don't conflict.
- **Check phase ordering**: If your plan depends on another spec's deliverables, note the dependency explicitly.
- **Verify shared schema compatibility**: If both specs touch `src/db/`, `src/utils/state.ts`, or Zod schemas, ensure alignment.
- **Check Done When assertions**: Ensure your phase gates don't contradict another plan's gates.

This step is what prevents specs from being "conjured from the same source but not well coordinated."

If conflicts are found:
- **Contract type conflict**: Flag as 🔴 RED. Stop and report to user. Do NOT attempt resolution.
- **Phase ordering dependency**: Document explicitly in plan.md Deferred Items with the dependent spec reference.
- **Shared schema incompatibility**: Flag as 🟡 AMBER. Document the discrepancy and proceed — resolution is the user's call.
</cross_reference_rules>

### 3. Load governance context

Determine which governance rules and skills apply to this feature. Read each applicable rule file:

| If feature touches... | Read this governance rule | Applicable skills |
|---|---|---|
| CLI commands, output | `docs/decisions/ADR-004-agent-native-output.md` | — |
| Fixtures, test data | `.agents/rules/seeding-governance.md` | — |
| Environment variables, config | `.agents/rules/workspace.md` | — |
| Architecture decisions | `.agents/skills/decision-forge/SKILL.md` | `decision-forge` |
| Spec quality | `.agents/skills/specify-sharpen/SKILL.md` | `specify-sharpen` |
| Any code changes | — | `compile-gate` (always implicit) |

### 4. Generate plan.md

Produce `{feature_dir}/plan.md` using the template at `.specify/templates/plan-template.md`.
Fill every `{{PLACEHOLDER}}` token. Do not invent sections or skip any.

<output_rules>
- Map **every** `US-###` and `FR-###` from the spec to a phase. Unmapped items go in Deferred Items.
- Use the gwrk source layout for file paths:
  - CLI entry → `src/cli.ts`
  - Command handlers → `src/commands/<command>.ts`
  - Business logic + discovery → `src/engine/<module>.ts`
  - Build server routes → `src/server/<module>.ts`
  - Shared utilities → `src/utils/<module>.ts`
  - SQLite → `src/db/index.ts`, `src/db/migrations/`
  - Tests → co-located `<module>.test.ts`
- **Phase sizing**: ≤10 file changes per phase. Split by functional boundary if larger.
- Every phase MUST have: Governance & Skills Contract, Test Strategy table, Done When section.
- **Test Strategy** maps `TR-###` to test type, target file, and executable assertion.
- **Done When** lists executable shell commands that prove the phase is complete.
- Every contract method in `contracts/` MUST be mapped to the phase that implements it.
- **Coverage Matrix** MUST account for every `US-###`, `FR-###`, `TR-###`, `TC-###`, `SC-###`, `VR-###`, `DM-###` from the spec.
- Deferred Items section MUST exist (even if "None — full coverage.").
- **Agent-Native compliance**: If the plan introduces new commands, each MUST specify: command type (query/generator/verifier/mutator), `[exit:N | Xs]` wrapper, `--format json` support, and error-as-navigation messages.
</output_rules>

### 5. Generate `data-model.md` (if entities exist in spec)

- Define SQLite schema additions (SQL CREATE TABLE statements).
- Define Zod types for domain schemas.
- Write to `{feature_dir}/data-model.md`.

### 6. Generate `contracts/` (MANDATORY if APIs or shared types exist)

- Define request/response schemas with **method-level granularity**.
- Not just type shapes — specify which service methods must exist, what they accept, what they return.
- Write to `{feature_dir}/contracts/`.

### 7. Report via notify_user

> "Plan created: {paths}. Next: `gwrk define tasks <feature>` to generate tasks.json and verification gates."

<quality_gate>
Before reporting, verify the plan includes:
- Governance & Skills Contract for every phase
- Test Strategy table for every phase (TR-### → target → assertion)
- Done When section for every phase (executable commands)
- Type dependency graph (if shared types exist)
- Method-level contracts (if APIs exist)
- Contract methods mapped to phases (if contracts/ exist)
- Exact file paths for every phase (using gwrk source layout)
- Phase sizing ≤10 files (split if larger)
- `FR-###` references for every deliverable
- Every `US-###` from spec is assigned to a phase or listed in Deferred Items
- Every `FR-###` from spec is assigned to a phase or listed in Deferred Items
- Every `TR-###`, `DM-###`, `SC-###`, `VR-###` from spec appears in Coverage Matrix
- Coverage Matrix section exists with zero unaccounted items
- Deferred Items section exists (even if empty: "None — full coverage")
- Agent-Native compliance: new commands have type, signal wrapper, format support, error guidance

If any are missing, add them before reporting.
</quality_gate>
