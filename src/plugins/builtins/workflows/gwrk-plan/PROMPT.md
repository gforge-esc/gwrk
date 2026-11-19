# /gwrk-plan

**Persona**: Senior Architect
**Pillar**: Definition (Clarity)

<code_quality>
{{enforcement}}
</code_quality>

<scope_constraints>
- Create plan.md (new) or amend an existing plan.md (when the input starts with "AMEND"). If the feature introduces new data models, ALSO create data-model.md. If the feature defines API contracts, ALSO create contracts/.
[type: gwrk-native]
- Do not create tasks.json (that's `gwrk define tasks`).
[/type]
[type: generic]
- Do not create the task execution ledger or low-level implementation tasks.
[/type]
- Do not implement any code.

**AMENDMENT MODE (when input starts with "AMEND existing plan"):**
- Read the existing `plan.md` FIRST — understand what phases exist and their status.
- PRESERVE all existing phases verbatim. Do NOT rewrite, renumber, or modify them.
- APPEND new phases after the last existing phase, continuing the numbering sequence.
- Update the Coverage Matrix to include new US/FR/TR items from the amended spec.
- Update the Deferred Items section to move newly-planned items out of deferred.
- If the amendment only changes existing phases (e.g., correcting a file path), make the minimal edit — do NOT regenerate the entire plan.
</scope_constraints>

## Worktree

- Use the current worktree and the feature directory supplied by the command.
- Keep the current branch while writing the plan.

## Architecture Reference

[type: gwrk-native]
<architecture_reference>
The plan MUST be grounded in `docs/grounding/architecture.md`:
- **Project Structure** (§4): Map features to the correct source directory.
- **Tech Stack** (§10): TypeScript CLI (Commander.js), Fastify server, SQLite (better-sqlite3), Vitest, Biome.
- **Foxtrot Charlie Pillars**: Discovery, Definition, Shipping, Delivery — commands align to pillars.
- **Agent-Native Contract** ([ADR-004](docs/decisions/ADR-004-agent-native-output.md)): Every command emits `[exit:N | Xs]` on stderr. `--format json` is independent. `--agent` activates Layer 2 protections.

Source layout follows the hexagonal dependency direction:
- Pure domain policy and validated domain values belong in `src/domain/`.
- Boundary contracts belong in `src/ports/`.
- Use cases belong in `src/application/` and depend inward on domain and port contracts.
- Filesystem, database, network and CLI effects belong in `src/adapters/`.
- Composition wires adapters to ports. Preserve existing compatibility entry points during migration.
- Read the current source tree before naming files. Legacy engine and server modules remain migration surfaces.

Database Standards:
- **SQLite**: Local-first via `better-sqlite3`. WAL mode.
- **Schema Management**: SQL migrations in `src/db/migrations/`.
- **No ORM**: Direct SQL queries.
- **DB Access Constraint**: `gwrk project discover` and all discovery commands MUST work without SQLite access (repository-only). Build-server commands that need SQLite MUST fail fast if unavailable.

Decisions:
- Read `.gwrk/decisions/index.md` (also injected via `<architecture_decisions>`) for all recorded architecture decisions and constraints.
</architecture_reference>
[/type]

[type: generic]
Read the selected architecture target and decision index when present. Use the project's language, framework, toolchain and existing directory structure. Target context does not establish existing code conformance.
[/type]

## Inputs

- `feature_dir`: Path to spec directory (e.g., `specs/013-agent-native-interface`)

## Prerequisites

- `{feature_dir}/spec.md` exists.

## Steps

### 1. Check the specification

- Check that `{feature_dir}/spec.md` exists in the current worktree.
- If the file is missing, stop and report the expected path.

### 2. Load context

- Read `{feature_dir}/spec.md` (required).
[type: gwrk-native]
- Read `docs/grounding/architecture.md` (required — for project structure, tech stack).
- Read `specs/000-build-plan.md` §Dependency Graph and §Critical Path — understand upstream/downstream impacts and where this spec fits.
- Read `docs/grounding/agent-native-cli.md` (required — for agent-native design imperatives and command surface).
- Read `docs/decisions/ADR-004-agent-native-output.md` (required — for output protocol contract).
[/type]
[type: generic]
- Read the host repository's architecture and planning documents to understand the technical context.
[/type]

### 2a. Cross-reference sister specs (MANDATORY)

<cross_reference_rules>
Read all existing specs and contracts to ensure plan compatibility:
```bash
ls specs/*/spec.md specs/*/contracts/*.md 2>/dev/null
```

For each spec that touches the same architectural components:
- **Read its contracts/**: Verify your planned types and APIs don't conflict.
- **Check phase ordering**: If your plan depends on another spec's deliverables, note the dependency explicitly.
- **Verify shared schema compatibility**:
[type: gwrk-native]
  If both specs touch `src/db/`, `src/utils/state.ts`, or Zod schemas, ensure alignment.
[/type]
[type: generic]
  If both specs modify shared data models or utilities, ensure alignment.
[/type]
- **Check Done When assertions**: Ensure your phase gates don't contradict another plan's gates.

This step is what prevents specs from being "conjured from the same source but not well coordinated."

If conflicts are found:
- **Contract type conflict**: Flag as 🔴 RED. Stop and report to user. Do NOT attempt resolution.
- **Phase ordering dependency**: Document explicitly in plan.md Deferred Items with the dependent spec reference.
- **Shared schema incompatibility**: Flag as 🟡 AMBER. Document the discrepancy and proceed — resolution is the user's call.
</cross_reference_rules>

### 3. Load governance context

Determine which governance rules and skills apply to this feature. Read each applicable rule file:

[type: gwrk-native]
| If feature touches... | Read this governance rule | Applicable skills |
|---|---|---|
| CLI commands, output | `docs/decisions/ADR-004-agent-native-output.md` | — |
| Fixtures, test data | `.gwrk/rules/seeding-governance.md` | — |
| Environment variables, config | `.gwrk/rules/workspace.md` | — |
| Architecture decisions | `.gwrk/decisions/index.md` | — |
| Spec quality | `~/.gwrk/plugins/skills/specify-sharpen/SKILL.md` | `specify-sharpen` |
| Any code changes | — | `compile-gate` (always implicit) |
[/type]

[type: generic]
Review the project's governance rules in the `.rules/` or `.gwrk/rules/` directory (if they exist) and apply relevant skills.
[/type]

### 4. Generate plan.md

Write `{feature_dir}/plan.md` in the canonical format below. Use an existing plan in the project as a formatting reference when available.

<output_rules>
- Map **every** `US-###` and `FR-###` from the spec to a phase. Unmapped items go in Deferred Items.
[type: gwrk-native]
- Map pure policy to `src/domain/`, boundary contracts to `src/ports/`, use cases to `src/application/` and effects to `src/adapters/`.
- Inspect the current source tree and composition before selecting paths. Preserve compatibility entry points required by the phase.
- Keep framework and storage types outside domain signatures. Pass clocks and environment values through ports or explicit inputs.
[/type]
[type: generic]
- Use the project's existing source layout for file paths.
[/type]
- **Phase sizing**: ≤10 file changes per phase. Split by functional boundary if larger.
- Every phase MUST have: Governance & Skills Contract, Test Strategy table, Done When section.
- **Test Strategy** maps `TR-###` to test type, target file, and executable assertion.
- **Done When** lists executable shell commands that prove the phase is complete.
- Every contract method in `contracts/` MUST be mapped to the phase that implements it.
- **Coverage Matrix** MUST account for every `US-###`, `FR-###`, `TR-###`, `TC-###`, `SC-###`, `VR-###`, `DM-###` from the spec.
- Deferred Items section MUST exist (even if "None — full coverage.").
[type: gwrk-native]
- **Agent-Native compliance**: If the plan introduces new commands, each MUST specify: command type (query/generator/verifier/mutator), `[exit:N | Xs]` wrapper, `--format json` support, and error-as-navigation messages.
[/type]
</output_rules>

### 4a. Canonical output format (MANDATORY — parser contract)

The `plan.md` you emit is a **contract with the deterministic `plan-to-tasks` parser**.
Author every phase in exactly the shape below so each
source-bearing phase resolves to a **runnable gate**, never an `echo "Phase N: …"` stub.
[type: gwrk-native]
Read `docs/grounding/023-plan-format-contract.md` for the parser contract.
[/type]

<canonical_output_format>
- **Section headings** use `####` (h4), never the `**bold:**` form:
  `#### Test Strategy`, `#### Done When`. The `**Section:**` form is NOT canonical.

- **File lines** use the em-dash form — a backticked path, a bold action, then a
  description, each separated by an em dash. `action ∈ {create, amend, delete}`
  (`create` → new-file task, `amend` → modify task, `delete` → delete task):

  - `path/to/new.ts` — **create** — what this new file does
  - `path/to/existing.ts` — **amend** — what you add to it
  - `path/to/stale.ts` — **delete** — why it is removed

  The parser captures the backticked path and the bold action. Do NOT use the legacy
  paren form `` - `path` (ACTION: desc) `` for new plans.

- **Test Strategy** is a table `| TR-### | Type | Target | Assertion |` where
  `Type ∈ {unit, integration, gate}` (bare `integration` or bracketed `[integration]`
  are both accepted) and `Target` is a backticked test file or command:

  | TR-### | Type | Target | Assertion |
  |---|---|---|---|
  | TR-001 | integration | `path/to/phase.test.ts` | observable behavior asserted |

- **Done When** uses a fenced `bash` code block. The parser copies its lines verbatim into the phase's `gateScript`. Use commands that exit non-zero on failure. Prose bullets remain descriptive for backward compatibility.

[type: generic]
Use the host repository's verification commands in each gate.
[/type]
[type: gwrk-native]
#### Done When
```bash
pnpm run build
pnpm vitest run path/to/phase.test.ts
```
[/type]
[type: python]
#### Done When
```bash
python -m pytest tests/test_phase.py
```
[/type]

- **Assert on exit codes.** Run each verification command directly. Under Layer 2's `set -e`, a non-zero exit code fails the gate.

- **Forbidden — the output-as-pass antipattern.** Never write `<cmd> | grep -q <pattern>`
  (nor `<cmd> 2>&1 | grep -q <pattern>`) in a Done-When block. **Why it lies:** on failure
  the searched-for pattern can still appear in the command's error output, and because
  Layer 2 uses `set -e` **without** `pipefail`, only the trailing `grep -q`'s exit status
  decides the pipeline — the producer's non-zero exit is masked, yielding a false green.

  **Output checks.** If output needs inspection, capture it to a file so `set -e` can enforce the command's exit code. Run `grep -q` on the file in the next step.

[type: gwrk-native]
  ```bash
  pnpm vitest run path/to/phase.test.ts > out.log
  grep -q "expected pattern" out.log
  ```
[/type]
[type: python]
  ```bash
  python -m pytest tests/test_phase.py > out.log
  grep -q "expected pattern" out.log
  ```
[/type]

  A bare `grep -q <pattern> <file>` that reads a file (never a pipe from a command) stays
  allowed.
</canonical_output_format>

### 5. Generate `data-model.md` (if entities exist in spec)

- Use the project's selected storage and schema validation standards. Define storage changes only when the feature requires them.
- Define validated domain values and boundary contracts in the project's language. Keep framework types outside the domain.
- Write to `{feature_dir}/data-model.md`.

### 6. Generate `contracts/` (MANDATORY if APIs or shared types exist)

- Define request/response schemas with **method-level granularity**.
- Not just type shapes — specify which service methods must exist, what they accept, what they return.
- Write to `{feature_dir}/contracts/`.

### 7. Report the plan

[type: gwrk-native]
> "Plan created: {paths}. Next: `gwrk define tasks <feature>` to generate tasks.json and verification gates."
[/type]
[type: generic]
> "Plan created: {paths}. Next: Proceed to task generation and implementation."
[/type]

<quality_gate>
Before reporting, verify the plan includes:
- Governance & Skills Contract for every phase
- Test Strategy table for every phase (TR-### → target → assertion)
- Done When section for every phase (executable commands)
- Type dependency graph (if shared types exist)
- Method-level contracts (if APIs exist)
- Contract methods mapped to phases (if contracts/ exist)
[type: gwrk-native]
- Exact file paths for every phase (using gwrk source layout)
[/type]
- Phase sizing ≤10 files (split if larger)
- `FR-###` references for every deliverable
- Every `US-###` from spec is assigned to a phase or listed in Deferred Items
- Every `FR-###` from spec is assigned to a phase or listed in Deferred Items
- Every `TR-###`, `DM-###`, `SC-###`, `VR-###` from spec appears in Coverage Matrix
- Coverage Matrix section exists with zero unaccounted items
- Deferred Items section exists (even if empty: "None — full coverage")
[type: gwrk-native]
- Agent-Native compliance: new commands have type, signal wrapper, format support, error guidance
[/type]

If any are missing, add them before reporting.
</quality_gate>
