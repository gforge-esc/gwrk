# Domain Ontology: gwrk

## Scope
- **In-scope**: The core execution pipeline (Discovery, Definition, Shipping, Measure), task tracking, gate verification, and the relationship between human judgment and agent execution.
- **Out-of-scope**: Specific product features being built with gwrk; third-party tool internals (e.g., Git, pnpm).
- **Adjacent**: GitHub/Slack integration APIs, specific programming language standards (TypeScript, Rust).

## Classes
| Class | Definition | Boundary Test | Example Individuals |
|---|---|---|---|
| Initiative | A discrete unit of engineering work with a defined lifecycle from discovery to delivery. | Not a Task. An initiative contains phases and tasks; it represents the high-level goal. | gwrk-ontology, slack-control-plane, 007-effort-compression |
| Commitment | A version-controlled, written artifact that binds execution and represents a project's truth. | Not a Conversation. If it's not in the repository as a file, it's not a commitment. | spec.md, plan.md, tasks.json |
| Agent | An ephemeral, disposable executor that transforms a task and context into a code diff or artifact. | Not gwrk. gwrk is the orchestrator; the Agent is the stateless worker. | gemini-1.5-pro, claude-3.5-sonnet, codex-cloud |
| Judgment | A non-automatable human decision that defines "done" and shapes the project's direction. | Not a Process. Methodology is the process; Judgment is the human choice within or over the process. | PR Merge Approval, Architecture Selection, Phase Start Decision |
| Signal | A computable metric derived from artifacts that provides evidence of engineering efficiency or truth. | Not an Opinion. Signals are derived from data like gate results or commit history. | Compression Ratio, Gate Pass/Fail, Test Coverage Delta |
| Methodology | A repeatable intellectual process with defined inputs and outputs used to extract truth or clarity. | Not a Tool. gwrk is the tool; ontology construction is the methodology. | JTBD Discovery, Ontology Construction, Spec-Sharpening |
| Task | The smallest unit of decomposed work, mapped to a single gate and tracked in the execution ledger. | Not a Phase. A phase is a container for tasks. | T001-create-types, T002-implement-parser, T003-add-tests |
| Gate | An automated verification script that exits with a binary status (0/1) to enforce truth. | Not a Test. A test is a behavioral check; a gate is the script that invokes tests to block task completion. | T001-gate.sh, T015-gate.sh |
| Phase | A logical grouping of tasks within an initiative, used for sequential execution and checkpointing. | Not an Initiative. An initiative has multiple phases. | Phase 01 (Core Engine), Phase 02 (CLI Integration) |
| Contract | A formal, written specification of an interface, type, or behavioral expectation. | Not a Spec. A spec is a high-level requirement; a contract is the technical binding. | api-contract.md, state-contract.md, gate-check.md |

## Properties
| Class | Property | Kind | Description | Constraint |
|---|---|---|---|---|
| Initiative | id | identifier | Unique slug or numeric prefix | String, e.g., "001-cli-core" |
| Initiative | status | state | Current pillar in the lifecycle | discovery, definition, shipping, delivered |
| Commitment | filePath | identifier | Location in the repository | Relative path string |
| Task | id | identifier | Unique ID within the feature | T### format (e.g., T001) |
| Task | status | state | Progress of the task | open, blocked, completed |
| Task | sp | intrinsic | Estimated effort (Story Points) | Integer |
| Gate | result | state | Outcome of the last execution | 0 (PASS), 1 (FAIL) |
| Signal | value | derived | Numerical or boolean measurement | Float (ratios) or Boolean |

## Relations
| Relation | Domain | Range | Cardinality | Required? |
|---|---|---|---|---|
| decomposes_into | Initiative | Phase | 1:N | Y |
| contains | Phase | Task | 1:N | Y |
| produces | Initiative | Commitment | 1:N | Y |
| is_gated_by | Task | Gate | 1:1 | Y |
| executes | Agent | Task | 1:1 | N (until dispatch) |
| shapes | Judgment | Initiative | N:1 | Y |
| validates | Gate | Task | 1:1 | Y |
| informs | Signal | Judgment | N:M | Y |
| follows | Initiative | Methodology | N:1 | N |

## Axioms
| ID | Rule | What It Prevents |
|---|---|---|
| AX-001 | Every task MUST have exactly one gate. | Unverified "done" states where work is claimed but not proven. |
| AX-002 | A task status cannot be "completed" unless its gate exits 0. | Narrative-based progress where agents (or humans) pretend work is finished. |
| AX-003 | All commitments MUST be committed to the repository to exist. | "Shadow truth" living in Slack, docs, or local machines instead of the repo. |
| AX-004 | Agents are ephemeral and have no persistent state between tasks. | Hidden dependencies and non-reproducible builds. |
| AX-005 | Every initiative has a single accountable owner (human). | Shared ownership leading to lack of responsibility and stalled throughput. |
| AX-006 | Gates are never overwritten if they contain the `# AUTHORED` marker. | Silent loss of high-quality manual or LLM-authored verification logic. |

## Glossary
| Term | Canonical Meaning | Must Not Be Confused With |
|---|---|---|
| Compression Ratio | Ratio of estimated manual effort (SP) to actual delivery time. | Value measurement; it measures shipping efficiency only. |
| Truth | The actual state of the project as evidenced by passing gates and artifacts. | Narratives, status reports, or aspirational timelines. |
| Clarity | The degree to which commitments are specific, unambiguous, and testable. | Completeness; a spec can be clear but partial. |
| Throughput | The speed at which initiatives move from discovery to delivery. | Velocity; throughput is the end-to-end flow rate. |
| Hard Gate | A verification script whose success is the only way to progress state. | Soft check or lint warning. |
