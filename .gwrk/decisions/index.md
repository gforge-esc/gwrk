# Architecture Decision Index
> Generated from `docs/decisions/`. Do not edit by hand; run `gwrk define adr --reindex`.

| ADR | Scope | Status | Constraint |
|---|---|---|---|
| ADR-001 | gwrk core architecture | Decided · superseded in part by ADR-002 (storage mechanism only) | Every task MUST carry a gate script that exits 0 before `gwrk tasks done` records it complete, and an agent MUST NOT record completion any other way. |
| ADR-002 | gwrk core architecture | Decided · superseded in part by ADR-003 Partial aspects of ADR-002 §3 (Learning Loop Extraction) | Task state MUST be read from and written to the git-tracked `tasks.json`, and `~/.gwrk/gwrk.db` MUST NOT be treated as the source of truth for task state. |
| ADR-003 | gwrk state architecture | Decided | Agents MUST report execution telemetry by committing a git-native run manifest under `specs/<feature>/.gwrk/runs/`, and MUST NOT write to `gwrk.db` directly. |
| ADR-004 | gwrk CLI contract for agent consumption | Decided | Every command MUST emit the operational signal `[exit:N \| Xs]` on completion, and `--agent` mode MUST NOT change the output format beyond its protective transforms. |
| ADR-005 | gwrk gate generation, TDD enforcement, define pipeline | Decided | Gates MUST be authored against a contract and MUST NOT be heuristically generated, stubbed, or left asserting file existence in place of behaviour. |
| ADR-006 | gwrk plugin system, agent dispatch, task execution | Decided | gwrk core MUST dispatch through the `AgentBackend` plugin interface and MUST NOT reference any agent CLI's name, flags, or proprietary exit codes. |
| ADR-007 | gwrk dispatch architecture, governance file authority, `.agents/` lifecycle | Decided | Code MUST NOT spawn an agent CLI directly; dispatch MUST go through `WorkflowRuntime`. |
| ADR-008 | Agent execution model, prompt architecture, workflow safety | Decided | Every agent-dispatched sub-command MUST run non-interactively under a bounded timeout, and MUST NOT be able to block on an editor, a pager, or a prompt. |
| ADR-009 | Agent grounding, prompt context, project perspective | Decided | Dispatch MUST inject the project's domain ontology, information hierarchy, and UX posture when those files exist, and gwrk MUST NOT ship default content in their place. |
| ADR-010 | gwrk definition, grounding, and verification pipeline | Decided | Every recorded architecture decision MUST live in `docs/decisions/` and reach every agent dispatch through the derived index at `.gwrk/decisions/index.md` without introducing a fifth governance carrier. |

<!-- hash: 6e27ade0a84b4b0a -->
<!-- rows: {"ADR-001":"669780d3520b3b57","ADR-002":"63f29c31b5b55d0d","ADR-003":"50e02a0a2729c8b6","ADR-004":"2fb3e461a2b72eaa","ADR-005":"3c70a7962a73059b","ADR-006":"7b0862d65a60ef86","ADR-007":"7d1c2ec5964d229c","ADR-008":"6a4ed1c389384d7a","ADR-009":"a52614336734852d","ADR-010":"d41e52a39d4186db"} -->
