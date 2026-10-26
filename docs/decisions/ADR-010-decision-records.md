# ADR-010: Decision Records

> **Status:** Decided
> **Date:** 2026-10-23
> **Decision:** Architecture decisions are authored in `docs/decisions/` via `gwrk define adr`, projected into `.gwrk/decisions/index.md` at command time, and injected uniformly into every agent dispatch as `<architecture_decisions>`.
> **Constraint:** Every recorded architecture decision MUST live in `docs/decisions/` and reach every agent dispatch through the derived index at `.gwrk/decisions/index.md` without introducing a fifth governance carrier.
> **Depends on:** ADR-004 (CLI Ergonomics & Agent-Native Design), ADR-005 (TDD Gate Architecture), ADR-006 (Plugin Agent Backends), ADR-007 (Single Dispatch Path)
> **Author:** David Gonzalez · **Decision Scope:** gwrk definition, grounding, and verification pipeline

---

## 1. Context

Nine architecture decision records existed in `docs/decisions/`, but no CLI command authored, indexed, amended, or verified them. Enumerations in `plan-renderer.ts`, `gwrk-plan/PROMPT.md`, and `docs/grounding/architecture.md` stopped at ADR-004 or ADR-006, and `IMPLEMENT` plus the four review stages received zero decision context. Unverified prose citations allowed `src/engine/ship-orchestrator.ts` to cite a `028 correction` that `ADR-007` did not carry.

## 2. Decision

### 2.1 Carrier Ranking and No Fifth Governance Carrier

`docs/decisions/` remains the sole human-authored corpus for architecture decisions, and `.gwrk/decisions/index.md` is a derived projection of that corpus (TC-004). No fifth governance carrier is introduced alongside `.gwrk/rules/`, `docs/grounding/`, `.gwrk/agent-context.md`, and `src/plugins/builtins/skills/`.

### 2.2 Document, Not Requirement

An ADR is a document carrying a requirement-class identifier (`ADR-NNN`), not a requirement node in the plan graph (TC-005). No SQLite spine table, `plan_features` row, or `tasks.json` entry models an ADR (DM-001), and `gwrk define adr --check` acts as a citation resolver over `docs/decisions/` rather than coupling to `drift-detector`.

### 2.3 Blockquote Header Over YAML Frontmatter

Record metadata uses the house `> **Field:**` blockquote header following the H1, matching `plan-renderer.ts` and the nine existing records (TC-007). Each record carries a one-sentence imperative `> **Constraint:**` (`MUST` or `MUST NOT`) projected into the index row so the full corpus fits within the 1000-token dispatch budget (TC-010).

### 2.4 Command-Time Index and Uniform Grounding Injection

`.gwrk/decisions/index.md` is generated at command time (on record creation, `--amend`, `--append-section`, `--decide`, `--reindex`, and `gwrk init`) with a SHA-256 content hash computed over parsed headers (DM-002). `src/utils/agent.ts` injects `.gwrk/decisions/index.md` as `<architecture_decisions>` uniformly across every stage with no scope filter and fail-open semantics (TC-009, TC-016).

### 2.5 Derived-Only Supersession Back-References

Supersession is declared forward only via `> **Supersedes:**` in the superseding record. `buildIndex` derives the inverse `superseded in part by` status note onto the target record's index row and preserves the scope qualifier verbatim (FR-012, OQ-002). `Superseded by` is never written into `docs/decisions/`.

### 2.6 Section-Addressed Amendments and Citation Verification

Amendments resolve through the parsed heading tree (`--amend --at <section>` or `--append-section`) and register in a trailing unnumbered `## Amendments` table (FR-020, FR-021, FR-022). `gwrk define adr --check` enforces three mechanical assertions in CI: every citation resolves to a file in `docs/decisions/`, every `NNN correction` citation resolves to a registered entry in `## Amendments`, and the stored index hash matches the parsed corpus headers (FR-024).

## 3. Decision Record

| Field | Value |
|---|---|
| Position | Author ADRs via `gwrk define adr`, project headers into `.gwrk/decisions/index.md`, inject uniformly as `<architecture_decisions>`, and gate citations with `--check`. |
| Confidence | 9/10 |
| Reversibility | High. `.gwrk/decisions/index.md` is derived and can be regenerated or removed without touching `docs/decisions/`. |
| Risk | Low. Corpus growth past roughly 30 records could approach the 1000-token index budget, mitigated by the one-sentence `Constraint:` cap and token-budget test in `adr-index.test.ts`. |

## 4. Alternatives Rejected

- **YAML frontmatter:** Rejected because all nine existing records and `plan-renderer.ts` use `> **Field:**` blockquote headers (TC-007).
- **Dispatch-time corpus parsing:** Rejected because reading and parsing every ADR file on every agent dispatch adds unnecessary I/O when command-time index generation plus `--check` in CI guarantees freshness.
- **Storing the index at `docs/decisions/INDEX.md`:** Rejected because `source-scanner.ts` reads `docs/decisions/` and would feed the index back into the ontology prompt alongside the corpus.
- **Line-number amendment addressing:** Rejected because line numbers drift on any edit above the target; heading-tree section addresses stay stable.

## 5. Impact on Existing Code

- `src/engine/adr-parser.ts`, `src/engine/adr-scaffold.ts`, `src/engine/adr-index.ts`, `src/engine/adr-amend.ts`, `src/engine/adr-check.ts`: parser, scaffolder, index generator, amendment engine, and citation checker.
- `src/commands/adr.ts`, `src/commands/define.ts`: `gwrk define adr` CLI surface (`--print`, `--run`, `--reindex`, `--check`, `--amend`, `--at`, `--append-section`, `--decide`, `--audit`).
- `src/utils/agent.ts`: fourth `groundingFiles` entry injecting `.gwrk/decisions/index.md` as `<architecture_decisions>`.
- `src/engine/source-scanner.ts`, `src/commands/define-ontology.ts`: separate `material.decisions` from `material.patterns`.
- `src/engine/plan-renderer.ts`, `docs/grounding/architecture.md`, `.gwrk/agent-context.md`, builtin workflow prompts: replace static ADR enumerations with `.gwrk/decisions/index.md`.

## 6. Consequences

- Every agent dispatch (`specify`, `plan`, `tasks`, `analyze`, `implement`, and all four review stages) receives the full table of recorded constraints in under 1000 tokens.
- Unregistered `NNN correction` citations and dangling `ADR-NNN` links fail CI via `gwrk define adr --check`.
- Creating, amending, or ratifying an ADR updates both the record and `.gwrk/decisions/index.md` in one command.

## 7. References

- `specs/029-decision-records/spec.md`
- `specs/029-decision-records/plan.md`
- `docs/research/R012-adr-first-class/brief.md`

## Amendments

| Amending | At | Summary |
|---|---|---|
