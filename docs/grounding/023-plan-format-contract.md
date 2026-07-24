# Grounding: 023 — Plan Format Contract (executable gates)

Reference brief for `gwrk define spec`. Captures the verified problem, evidence, and
the agreed design. The spec should be authored from this; do not re-derive from scratch.

## Problem

gwrk's plan→tasks parser and the format plans are actually authored in have drifted
apart. When the parser can't extract a phase's real gate, it emits an **`echo` stub**
that always exits 0. The ship loop's mechanical `TEST_GATE` then passes on the stub
while the plan's real behavioral gate never runs — a false-green that surfaces only
much later.

**Motivating case (data-dashboard, feature 002-metric-model, phase-03):**
- The plan's Done-When gate is `make test:db` (Docker + migrated Postgres → `node --test tests/db/`).
- The generated `gateScript` is `echo "Phase 3: …"`.
- `gwrk gate 002-metric-model` reports **3/3 PASS**, but `make test:db` actually **fails 0/2**:
  `src/lib/db/client.js:24` uses a bare `new PrismaClient()`, which Prisma 7 rejects
  (needs a driver adapter — `@prisma/adapter-pg` + `pg`, neither installed).
- gwrk cannot see the failure. The ship that produced 002 was false-green for exactly this reason.

## Evidence (gwrk source; verify against current tree)

`src/engine/plan-to-tasks.ts`:
- Done-When section recognized **only** as an `^#### Done When` heading; body read **only**
  as `- bullet` lines.
- Test Strategy recognized **only** as `^#### Test Strategy`; table rows matched by
  `| TR-\d+ | \w+ | `target` |` — the `\w+` type token cannot match `[integration]`.
- Phase gate = `doneWhen[0]` when present, else the fallback **`echo "Phase N: …"`** stub.
- File lines matched **only** by the paren form `` - `path` (ACTION: desc) ``. This matches
  **neither** gwrk's own plans **nor** data-dashboard's — both author file lines in the
  **em-dash** form `` - `path` — **action** — desc ``. So file extraction yields nothing and
  tasks collapse to the phase-title stub.

Dialect facts:
- gwrk's own `#### Done When` bodies are **prose bullets** (e.g. `` - `gwrk init` detects CLIs ✅ ``)
  — descriptive, **not executable**.
- data-dashboard's `**Done When:**` bodies are **fenced ```bash blocks that execute**
  (`make dev:up && make db:migrate && make test:db`).

## Root cause

The parser encodes one grammar; real plans are authored in another, and **nothing
validates that a generated plan yields executable gates.** The drift is invisible until
it manifests as a false-green ship.

## Canonical plan format (the contract this feature establishes)

Per phase:

- **Section headings** use `####` (h4): `#### Test Strategy`, `#### Done When`. (gwrk's 13
  specs already use `####`; the `**bold:**` form is not canonical.)
- **Done When** body is a fenced ` ```bash ` block — the **only** form that is executable.
  That block becomes the phase's `gateScript` verbatim.
- **File lines** use the em-dash form: `` - `path` — **action** — description `` where
  `action ∈ {create, amend, delete}`. Parser extracts the backticked path + the bold action.
- **Test Strategy** is a table `| TR | Type | Target | Assertion |` where
  `Type ∈ {unit, integration, gate}` (bare or `[bracketed]`); `Target` is backticked
  (a test file or a command).

Example (illustrative):

    ### Phase 3 — Repository & behavioral tests

    **Files:**
    - `src/lib/db/client.js` — **create** — Prisma client singleton
    - `tests/db/reading-store.test.js` — **create** — TR-005/006/007

    #### Test Strategy
    | TR | Type | Target | Assertion |
    |----|------|--------|-----------|
    | TR-004 | integration | `tests/db/definitions.test.js` | lifecycle transitions |

    #### Done When
    ```bash
    make dev:up && make db:migrate && make test:db
    ```

## Scope — committed changes

- **A. Parser (`plan-to-tasks.ts`)** reads the canonical format:
  fenced-bash Done-When → executable `gateScript`; em-dash file lines; `Type`-flexible
  Test Strategy table. Existing `####`+bullet plans continue to parse (backward compatible).
- **B. Generator (`gwrk-plan/PROMPT.md`)** emits the canonical format going forward.
- **C. `define` self-validation:** after generating `plan.md`, run the parser on it; if any
  source-bearing phase resolves to an `echo` stub (no executable gate), `define` **fails
  loudly** rather than silently emitting a stub. This closed loop is the durable prevention.

## Out of scope

- Authoring real executable gates for gwrk's own 13 specs (content work, not a parser fix).
- The throwaway migration script that normalizes existing plans (temporary, uncommitted).

## Acceptance (what "done" proves)

- A plan with a fenced-bash Done-When yields a runnable `gateScript`, not an `echo` stub.
- A plan with only prose/no executable gate causes `define` to fail with a clear message.
- Given a fixed parser, `gwrk gate` on a phase whose gate is `make test:db` runs it and
  reports RED when the underlying suite fails (no false green).
- Existing gwrk `####`+bullet plans still parse without regression.
