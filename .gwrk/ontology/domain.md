# Domain Ontology: gwrk

## Scope
- **In-scope**: The core execution pipeline (Discovery, Definition, Shipping, Measure), task tracking, gate verification, architectural decision records, and the relationship between human judgment and agent execution.
- **Out-of-scope**: Specific product features built with gwrk; third-party tool internals (Git, pnpm, SQLite engine internals).
- **Adjacent**: GitHub, Slack, and Telegram integration APIs; language-specific compiler toolchains (TypeScript, Rust, Python).

## Classes
| Class | Definition | Boundary Test | Example Individuals | Source |
|---|---|---|---|---|
| Initiative | A discrete unit of engineering work with a defined lifecycle from discovery to delivery. | Not a Task. An Initiative contains multiple phases and tasks and represents the feature-level goal. | 001-cli-core, 014-plugin-system, 028-review-finding-liveness, 029-decision-records | `specs/000-build-plan.md` |
| Commitment | A version-controlled written artifact in the repository that binds execution and records project truth. | Not a Conversation. Any statement not persisted as a tracked repository file is not a Commitment. | specs/029-decision-records/spec.md, specs/029-decision-records/plan.md, docs/decisions/ADR-010-decision-records.md, .gwrk/decisions/index.md | `docs/decisions/ADR-003-state-contract.md` |
| Agent | An ephemeral, stateless executor backend that transforms a task and grounded context into a code diff or structured intent envelope. | Not gwrk. gwrk is the orchestrator and verification harness; the Agent is the replaceable worker. | agy, claude, codex | `src/plugins/agent-backend.ts` |
| Judgment | A non-automatable human decision that ratifies architectural constraints, approves scope, or merges a pull request. | Not a Methodology. Methodology is the repeatable process; Judgment is the accountable human choice over that process. | ADR-010 Ratification, PR #199 Merge Approval, Phase 0 Roadmap Approval | `docs/decisions/ADR-010-decision-records.md` |
| Signal | A computable metric derived from repository artifacts and execution runs that provides evidence of engineering truth or shipping efficiency. | Not an Opinion. Signals are deterministic outputs of gates, git history, or ledger queries. | Compression Ratio, Gate Exit Code, ADR Citation Check Report, Velocity Pulse | `src/engine/compression.ts` |
| Methodology | A repeatable intellectual workflow with defined inputs, passes, and output contracts used to extract clarity from source material. | Not a CLI Command. `gwrk define` is the command surface; ontology construction and JTBD discovery are Methodologies. | Five-Primitive Ontology Construction, JTBD Discovery, Technical Research Synthesis | `src/commands/research.ts` |
| Task | The smallest unit of decomposed implementation work inside a phase, mapped to a single verification gate and tracked in `.gwrk/tasks.json`. | Not a Phase. A Phase groups multiple tasks into a shippable increment. | T001, T021, T038, T043 | `src/utils/state.ts` |
| Gate | An automated, deterministic verification script that exits 0 (pass) or non-zero (fail) to prove a task or phase requirement holds. | Not a Unit Test. A unit test checks code behavior inside a test runner; a Gate is the shell contract that blocks task completion. | specs/029-decision-records/gates/T002-gate.sh, specs/029-decision-records/gates/T023-gate.sh, specs/029-decision-records/gates/T039-gate.sh | `src/utils/gate-exec.ts` |
| Phase | A sequential grouping of tasks within an Initiative that forms a single reviewable and shippable unit of work. | Not an Initiative. An Initiative decomposes into multiple ordered phases. | 029-decision-records/phase-01, 029-decision-records/phase-05, 029-decision-records/phase-10 | `src/engine/ship-orchestrator.ts` |
| Contract | A formal schema or interface specification that constrains the boundary between two modules, commands, or agent workflows. | Not a Spec. A Spec states user and functional requirements; a Contract binds the exact signature, CLI flags, or JSON schema. | specs/029-decision-records/contracts/adr-command.md, specs/029-decision-records/contracts/adr-format.md, WorkflowManifestSchema | `src/plugins/manifest.ts` |

## Properties
| Class | Property | Kind | Description | Constraint |
|---|---|---|---|---|
| Initiative | id | identifier | Unique numeric-prefixed feature slug | Format `NNN-kebab-slug` (e.g., `029-decision-records`) |
| Initiative | status | state | Lifecycle stage in the build plan | `PLANNED`, `SPECIFIED`, `DEFINED`, `IN_PROGRESS`, `SHIPPED`, `CLOSED` |
| Commitment | filePath | identifier | Repository-relative path to the artifact | Non-empty relative path string |
| Commitment | contentHash | derived | SHA-256 digest of the artifact or header corpus | 16-char or 64-char lowercase hex |
| Agent | name | identifier | Registered backend identifier | `agy`, `claude`, `codex` |
| Agent | emitsStreamJson | intrinsic | Whether the CLI emits line-delimited JSON events | Boolean |
| Judgment | actor | intrinsic | Accountable human author or approver | Non-empty author identity |
| Judgment | recordedAt | state | ISO-8601 date or timestamp of ratification | `YYYY-MM-DD` or ISO-8601 string |
| Signal | value | derived | Computed numerical ratio or boolean pass state | Finite number or boolean |
| Signal | sourceRunId | extrinsic | Execution ledger run ID that produced the signal | Integer run ID or `dry-run` |
| Methodology | name | identifier | Canonical workflow plugin identifier | Kebab-case string (`gwrk-research-ontology`, `gwrk-adr-record`) |
| Methodology | enforceOutputSchema | intrinsic | Whether structured JSON output is enforced at the CLI level | Boolean |
| Task | id | identifier | Unique task identifier within the feature | Format `T###` (e.g., `T001`) |
| Task | status | state | Current execution status in `.gwrk/tasks.json` | `open`, `in_progress`, `completed`, `blocked` |
| Task | sp | intrinsic | Estimated manual effort in story points | Non-negative integer |
| Gate | path | identifier | Repository path to the executable gate script | `specs/<feature>/gates/<id>-gate.sh` |
| Gate | exitCode | state | Process exit code from the latest gate execution | `0` (pass) or `1..255` (fail) |
| Gate | authored | intrinsic | Whether the script carries the `# AUTHORED` marker | Boolean |
| Phase | id | identifier | Phase identifier within the parent Initiative | Format `phase-NN` (e.g., `phase-01`) |
| Phase | order | intrinsic | Sequential execution index within `plan.md` | Positive integer |
| Contract | schemaPath | identifier | Path to the contract markdown or Zod schema definition | Relative path string |
| Contract | version | intrinsic | Semantic version of the plugin or contract schema | `MAJOR.MINOR.PATCH` |

## Relations
| Relation | Domain | Range | Cardinality | Direction | Inverse | Required? |
|---|---|---|---|---|---|---|
| decomposes_into | Initiative | Phase | 1:N | unidirectional | belongs_to_initiative | Y |
| contains | Phase | Task | 1:N | unidirectional | belongs_to_phase | Y |
| produces | Initiative | Commitment | 1:N | unidirectional | commits_initiative | Y |
| binds | Contract | Commitment | 1:N | unidirectional | conforms_to | Y |
| is_gated_by | Task | Gate | 1:1 | unidirectional | validates | Y |
| executes | Agent | Task | 1:N | unidirectional | executed_by | N |
| shapes | Judgment | Initiative | 1:N | unidirectional | ratified_by | Y |
| informs | Signal | Judgment | M:N | unidirectional | grounded_in_signal | Y |
| applies | Initiative | Methodology | N:1 | unidirectional | applied_by | N |

## Individuals
| Class | Individual | Description |
|---|---|---|
| Initiative | 001-cli-core | Core CLI bootstrap, config layering, and SQLite execution ledger initiative. |
| Initiative | 028-review-finding-liveness | Ship-loop review finding durability and one-way NO-GO verdict ratchet initiative. |
| Initiative | 029-decision-records | First-class ADR authoring, indexing, amendment, and citation verification initiative. |
| Commitment | specs/029-decision-records/spec.md | Feature specification binding requirements FR-001 through FR-027 for decision records. |
| Commitment | docs/decisions/ADR-010-decision-records.md | Ratified architecture decision record governing `.gwrk/decisions/index.md`. |
| Commitment | .gwrk/decisions/index.md | Derived architecture decision index injected into every agent dispatch. |
| Agent | agy | Google Antigravity 2.0 CLI adapter (`src/plugins/builtins/agents/agy/adapter.ts`). |
| Agent | claude | Anthropic Claude Code CLI adapter (`src/plugins/builtins/agents/claude/adapter.ts`). |
| Agent | codex | OpenAI Codex CLI adapter (`src/plugins/builtins/agents/codex/adapter.ts`). |
| Judgment | ADR-010 Ratification | Human decision flipping ADR-010 from `Proposed` to `Decided` via `gwrk define adr --decide`. |
| Judgment | PR #199 Merge Approval | Human review and merge of the decision-records and control-plane pull request to `main`. |
| Judgment | Phase 0 Roadmap Approval | Human blessing of the November execution roadmap artifact prior to implementation. |
| Signal | Compression Ratio | Ratio of LOC-derived or task-estimated story points to actual wall-clock shipping duration. |
| Signal | Gate Exit Code | Binary exit status (`0` or non-zero) returned by `runTaskGate` in `src/utils/gate-exec.ts`. |
| Signal | ADR Citation Check Report | Verification result emitted by `gwrk define adr --check` (`src/engine/adr-check.ts`). |
| Methodology | Five-Primitive Ontology Construction | Domain modeling workflow defined in `src/plugins/builtins/workflows/gwrk-research-ontology/PROMPT.md`. |
| Methodology | Technical Research Synthesis | First-principles technical investigation workflow (`gwrk-research-technical`). |
| Methodology | JTBD Discovery | Jobs-to-be-Done problem discovery workflow (`gwrk-research-jtbd`). |
| Task | T001 | Create ADR parser types and header extraction in `029-decision-records` Phase 1. |
| Task | T021 | Implement `buildIndex`, `renderIndex`, and `writeIndex` in `src/engine/adr-index.ts`. |
| Task | T038 | Implement `checkCitations` and `scanSurface` in `src/engine/adr-check.ts`. |
| Gate | specs/029-decision-records/gates/T002-gate.sh | Hard gate verifying `parseAdr` and corpus parsing against `docs/decisions/`. |
| Gate | specs/029-decision-records/gates/T023-gate.sh | Hard gate verifying `.gwrk/decisions/index.md` generation and freshness checks. |
| Gate | specs/029-decision-records/gates/T039-gate.sh | Hard gate verifying `gwrk define adr --check` catches dangling citations and unregistered corrections. |
| Phase | 029-decision-records/phase-01 | Parser and corpus reconciliation phase of `029-decision-records`. |
| Phase | 029-decision-records/phase-05 | Index generator and `--reindex` phase of `029-decision-records`. |
| Phase | 029-decision-records/phase-10 | Citation checker `--check` and CI wiring phase of `029-decision-records`. |
| Contract | specs/029-decision-records/contracts/adr-command.md | CLI flag and exit-code contract for `gwrk define adr`. |
| Contract | specs/029-decision-records/contracts/adr-format.md | Markdown grammar contract for `docs/decisions/ADR-NNN-*.md` and `.gwrk/decisions/index.md`. |
| Contract | WorkflowManifestSchema | Zod schema in `src/plugins/manifest.ts` validating workflow plugin manifests. |

## Axioms
| ID | Type | Rule | What It Prevents |
|---|---|---|---|
| AX-001 | Cardinality | Every Task MUST be gated by at least one executable Gate (`1:1`). | Unverified completion claims where tasks are marked done without mechanical proof. |
| AX-002 | Conditional | If a Task's Gate exits non-zero, the Task status MUST NOT transition to `completed`. | Narrative progress where agents or humans advance phases over failing tests. |
| AX-003 | Universal | Every Commitment MUST exist as a tracked file in the repository (`docs/`, `specs/`, or `.gwrk/`). | Shadow truth stranded in chat logs, ephemeral terminal output, or unversioned scratch files. |
| AX-004 | Disjointness | An Agent is never a Judgment; an Agent MUST NOT ratify an ADR or merge a protected branch without human invocation. | Autonomous drift where execution backends rewrite their own architectural constraints. |
| AX-005 | Existential | Every Initiative MUST have a human Judgment owner and at least one Commitment (`spec.md`). | Unbounded vibe-coding without an explicit problem statement or acceptance boundary. |
| AX-006 | Conditional | If a Gate file contains the `# AUTHORED` marker, gate generation MUST NOT overwrite it. | Silent destruction of hand-authored or domain-specific verification logic during re-scaffolding. |

## Glossary
| Term | Canonical Meaning | Must Not Be Confused With |
|---|---|---|
| Ontology Primitive | One of the five formal modeling constructs in ADR-009 (`Classes`, `Properties`, `Relations`, `Individuals`, `Axioms`). | Operating Model Concept (`Initiative`, `Commitment`, `Agent`, `Judgment`, `Signal`, `Methodology` in `WHAT_IS_GWRK.md`). |
| Operating Model Concept | One of the six product-level nouns describing how gwrk turns human judgment into shipped software. | Ontology Primitive (the five structural tables of `.gwrk/ontology/domain.md`). |
| Compression Ratio | Ratio of estimated manual effort (SP) to actual wall-clock delivery time. | Customer value or outcome adoption; it measures shipping throughput only. |
| Truth | The verifiable state of the repository proven by passing gates and checked-in artifacts. | Status narratives, agent self-reports, or unverified prose summaries. |
| Clarity | The degree to which Commitments are specific, unambiguous, and mechanically verifiable. | Verbosity or document length; a concise spec with binary gates has high clarity. |
| Hard Gate | An executable shell script in `specs/<feature>/gates/` whose zero exit code is required to advance state. | Advisory lint warnings or non-blocking LLM review comments. |

## Excluded Concepts
| Concept | Why Excluded |
|---|---|
| Sprint | Calendar time-boxing is not part of the Foxtrot Charlie model; work decomposes into Initiatives and Phases instead. |
| Ticket | External issue-tracker items are inputs to Discovery, not repository Commitments (`ADR-001`). |
| SandboxWorktree | An ephemeral filesystem isolation mechanism (`src/server/sandbox.ts`), modeled as an extrinsic execution detail rather than a core domain class. |
| PromptTemplate | Implementation carrier (`PROMPT.md`) for a `Methodology`, not a separate domain class. |
| PullRequest | A GitHub transport artifact produced at the end of a `Phase`, tracked as a property on ledger runs rather than a distinct domain class. |
