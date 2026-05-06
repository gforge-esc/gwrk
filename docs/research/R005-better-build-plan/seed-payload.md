# F018 Build Plan Seed Payload

> **Purpose:** Structured inventory of every gwrk feature's actual state.
> **Intended use:** Input to `gwrk plan seed` to populate the build plan graph on F018 first boot.
> **Generated:** 2026-04-02 from build plan v13, `specs/` inventory, `src/` audit, git history.

---

## Features

### F000 — Extraction
```yaml
id: F000
name: Extraction
status: DONE
sp_estimate: 3
sp_actual: 3
health: CLEAN
completed_at: "2026-02-27"
hardened: true
rework_count: 0
artifacts:
  spec: false  # no formal spec, predates spec convention
  plan: false
  tasks: false
  runs: 0
notes: >
  Bootstrap extraction from code-red. .agents/, .specify/, scripts/dev/, Makefile.
  No formal spec — predates the convention. Complete and stable.
phases: []
```

---

### F000-TDD — TDD Infrastructure
```yaml
id: F000-TDD
name: TDD Infrastructure
status: DONE
sp_estimate: 15  # includes 001-003 hardening
sp_actual: ~15
health: CLEAN
completed_at: "2026-03-13"
hardened: true  # IS the hardening effort
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  gates: 1
  runs: 9
notes: >
  Merged PR #7. UAT GO (75a0a51). Code review GO (3ca5954).
  Established: GATE_STUB blocking, # AUTHORED preservation, gwrk test command,
  gwrk ship pre-flight block (FR-008). Fixed 22 failing 003-slack tests.
  Gap analyses produced for 001 and 002.
phases:
  - id: F000-TDD-P1
    name: Gate Standard + Enforcement
    status: DONE
    sp_estimate: 5
    health: CLEAN
  - id: F000-TDD-P2
    name: 001-003 Gap Analysis + Remediation
    status: DONE
    sp_estimate: 10
    health: CLEAN
```

---

### F001 — CLI Core
```yaml
id: F001
name: CLI Core
status: SHIPPED  # ⚠️ in build plan — shipped but not TDD-hardened to full standard
sp_estimate: 25
sp_actual: 25
health: STALE  # gates pass but 91% were test-f stubs pre-hardening; partially remediated
completed_at: "2026-03-05"
hardened: false  # gap analysis done (000-tdd FR-005), remediation partial
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 0
notes: >
  Commander.js CLI, SQLite execution ledger (ADR-002), gwrk new/init/specify/plan/tasks.
  Gap analysis identified: dispatchAgent() contract mismatch, 91% gate contamination.
  Partially remediated through 000-TDD and 004 development but never formally re-hardened.
  **Rework needed for F018:** gwrk plan becomes a new pillar command. F001 rework scope.
src_files:
  - src/cli.ts
  - src/commands/new.ts
  - src/commands/init.ts
  - src/commands/specify.ts
  - src/commands/plan.ts
  - src/commands/tasks.ts
  - src/commands/tasks-done.ts
  - src/commands/tasks-query.ts
  - src/commands/define.ts
  - src/utils/exec.ts
  - src/utils/config.ts
  - src/utils/state.ts
  - src/utils/history.ts
  - src/utils/parser.ts
  - src/utils/gate-gen.ts
  - src/db/index.ts
phases:
  - id: F001-P1
    name: CLI Bootstrap
    status: DONE
    sp_estimate: 10
    health: STALE
  - id: F001-P2
    name: Commands + SQLite
    status: DONE
    sp_estimate: 15
    health: STALE
```

---

### F002 — Build Server
```yaml
id: F002
name: Build Server
status: SHIPPED  # ⚠️ shipped but not TDD-hardened
sp_estimate: 18
sp_actual: 18
health: STALE  # 69% gate contamination pre-hardening; gap analysis done, remediation deferred
completed_at: "2026-03-08"
hardened: false  # gap analysis done (000-tdd FR-006), remediation deferred
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 6
notes: >
  Fastify daemon localhost:18790. Dispatch queue, worktree sandbox manager,
  sleep/wake lifecycle, network monitor, health endpoint.
  Gap analysis: FR-012 Dockerfile ⚠️, FR-016/018/019 weak assertions,
  FR-024 (server clean) ❌ missing.
  **Needed by F018:** heartbeat cron job, sigma.js viz endpoint.
src_files:
  - src/server/index.ts
  - src/server/dispatch.ts
  - src/server/sandbox.ts
  - src/server/git-manager.ts
  - src/server/types.ts
  - src/server/routes/
phases:
  - id: F002-P1
    name: Fastify Bootstrap + Dispatch
    status: DONE
    sp_estimate: 8
    health: STALE
  - id: F002-P2
    name: Sandbox + Git Manager
    status: DONE
    sp_estimate: 5
    health: STALE
  - id: F002-P3
    name: Resilience (sleep/wake/network)
    status: DONE
    sp_estimate: 5
    health: STALE
```

---

### F003 — Slack
```yaml
id: F003
name: Slack Integration
status: SHIPPED  # ⚠️ shipped, 10% stub contamination (lowest), needs rework for plan comms
sp_estimate: 13
sp_actual: 13
health: DRIFTED  # FR-014 (webhook) added post-ship, gap analysis is greenfield inventory not test audit
completed_at: "2026-03-10"
hardened: false  # 000-TDD fixed 22 tests, but gap analysis needs rewrite as FR-by-FR audit
rework_count: 1  # 000-TDD test fix pass
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 5
notes: >
  Socket Mode + Bolt SDK. Channel-per-project model.
  FR-014 (Slack Incoming Webhook) added 2026-03-14 but implementation status unclear.
  Gap analysis is a greenfield inventory, NOT a coverage audit — needs rewrite.
  **Rework needed:** F018 heartbeat → Slack, F018 viz links → Slack. Post-F003 rework.
src_files:
  - src/server/slack.ts
  - src/server/slack-commands.ts
  - src/server/slack-actions.ts
  - src/server/slack-messages.ts
  - src/server/slack-home.ts
  - src/server/slack-channel.ts
  - src/server/slack-presence.ts
  - src/server/slack-notify.ts
  - src/commands/setup-slack.ts
phases:
  - id: F003-P1
    name: Socket Mode + Commands
    status: DONE
    sp_estimate: 8
    health: DRIFTED
  - id: F003-P2
    name: Interactive Messages + Home Tab
    status: DONE
    sp_estimate: 5
    health: DRIFTED
```

---

### F004 — Ship Loop
```yaml
id: F004
name: Ship Loop
status: DONE
sp_estimate: 5
sp_actual: 5
health: DRIFTED  # stagePrCi() is a stub; ShipOrchestrator landed but PR creation stubs
completed_at: "2026-03-18"
hardened: true  # Merged PR #12, 28/28 gates, 404 tests, 0 failures
rework_count: 2  # Phase 5 (ShipOrchestrator) absorbed F004-R; multiple hotfixes during F014 ship attempts
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 5
notes: >
  Full ship loop: BRANCH_SETUP → IMPLEMENT → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE.
  ShipOrchestrator (P5) landed on develop after folding F004-R.
  **Known issue:** stagePrCi() is a stub that mocks success — real PR creation not implemented.
  **Known issue:** Multiple hotfix iterations during F014 ship attempts (branch handling, ENOENT crashes).
  dispatchToAgent() abstraction shipped (ADR-006 contract).
  **Needed by F018:** ship:complete event hook.
src_files:
  - src/commands/ship.ts
  - src/engine/ship-orchestrator.ts
  - src/engine/dispatch-orchestrator.ts  # legacy, may be deprecated
  - src/utils/agent.ts
  - src/utils/git.ts
  - src/utils/manifest.ts
phases:
  - id: F004-P1
    name: Foundation
    status: DONE
    sp_estimate: 1
    health: CLEAN
  - id: F004-P2
    name: Review Gates
    status: DONE
    sp_estimate: 1
    health: CLEAN
  - id: F004-P3
    name: PR + CI
    status: DONE
    sp_estimate: 1
    health: DRIFTED  # stagePrCi() stub
  - id: F004-P4
    name: Plugin Dispatch Boundary
    status: DONE
    sp_estimate: 1
    health: CLEAN
  - id: F004-P5
    name: ShipOrchestrator
    status: DONE
    sp_estimate: 1
    health: CLEAN
```

---

### F004-R — DefineOrchestrator (extracted from F004)
```yaml
id: F004-R
name: DefineOrchestrator
status: PLANNED  # depends on F014-R for workflow delivery
sp_estimate: 5
health: BLOCKED  # blocked on F014-R
rework_count: 0
artifacts:
  spec: false  # part of F004 spec as future work
  plan: false
  tasks: false
  runs: 0
notes: >
  TypeScript state machine to replace define-until-solid.sh.
  Mirrors ShipOrchestrator pattern. Blocked on F014-R for workflow delivery.
  Folded out of F004 Phase 5 scope into separate work item.
dependencies:
  - F014-R
phases:
  - id: F004-R-P1
    name: DefineOrchestrator Implementation
    status: PLANNED
    sp_estimate: 5
    health: BLOCKED
```

---

### F005 — Parallel Dispatch
```yaml
id: F005
name: Parallel Dispatch
status: DEFINED  # spec + plan + tasks exist, 0 implementation
sp_estimate: 8
health: BLOCKED  # blocked on F014-R
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 9  # define runs only, no ship runs
notes: >
  Multi-task concurrent execution using git worktree sandboxes.
  Spec/plan/tasks done (9 define runs), but no implementation started.
  Pre-implementation spec/plan/contract/gate remediation committed (3a80573).
  **Blocked on:** F014-R (plugin loader for AgentBackend adapters).
dependencies:
  - F002
  - F004
  - F014-R
phases:
  - id: F005-P1
    name: Sandbox Lifecycle + Dispatch
    status: DEFINED
    sp_estimate: 5
    health: BLOCKED
  - id: F005-P2
    name: Capacity Gate + Resource Limits
    status: DEFINED
    sp_estimate: 3
    health: BLOCKED
```

---

### F006 — Pulse
```yaml
id: F006
name: Pulse Scanner
status: SPECIFIED  # spec exists, plan exists, no implementation
sp_estimate: 5
health: STALE  # no activity ever
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 0
notes: >
  Productivity dashboard with historical git analysis.
  Spec and plan exist but zero implementation. No define or ship runs.
  Independent of critical path — off F001 only.
dependencies:
  - F001
phases:
  - id: F006-P1
    name: Git Scanner + PulseSnapshot
    status: SPECIFIED
    sp_estimate: 3
    health: STALE
  - id: F006-P2
    name: Historical Analysis
    status: SPECIFIED
    sp_estimate: 2
    health: STALE
```

---

### F007 — Effort + Compression
```yaml
id: F007
name: Effort + Compression
status: SPECIFIED  # spec exists, plan exists, no implementation
sp_estimate: 8
health: STALE
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 0
notes: >
  SP-driven estimation and delivery speed measurement.
  Spec and plan exist but zero implementation.
  Some compression logic exists in src/db/compression.ts (for F011/harvest).
  Independent of critical path.
dependencies:
  - F001
phases:
  - id: F007-P1
    name: Story Extraction + Role Bracketing
    status: SPECIFIED
    sp_estimate: 5
    health: STALE
  - id: F007-P2
    name: Compression Ratios + Leading Indicators
    status: SPECIFIED
    sp_estimate: 3
    health: STALE
```

---

### F008 — Agent Router (RETIRED)
```yaml
id: F008
name: Multi-Agent Router
status: RETIRED
sp_estimate: 0  # SP absorbed by F014-P4
health: CLEAN
completed_at: "2026-03-17"  # retirement date
rework_count: 0
artifacts:
  spec: true  # archived, not deleted
  plan: true
  tasks: true
  runs: 0
notes: >
  Folded into F014 Phase 4 (Routing Intelligence) on 2026-03-17.
  12 SP absorbed by F014. Original spec preserved at specs/008-agent-router/.
  See plugin-strategy-audit.md for full analysis.
phases: []
```

---

### F009 — Agent-DUT
```yaml
id: F009
name: Agent-DUT
status: PLANNED  # no spec dir
sp_estimate: 8
health: STALE
rework_count: 0
artifacts:
  spec: false  # no spec dir
  plan: false
  tasks: false
  runs: 0
notes: >
  Slack-native conversational ideation → spec generation.
  DUT protocol (SPARK→PROBE→DISAMBIGUATE→SHAPE→PRESS→GROUND→REVIEW→COMMIT).
  No implementation, no spec directory. Described only in build plan.
dependencies:
  - F003
phases:
  - id: F009-P1
    name: DUT Conversational Loop
    status: PLANNED
    sp_estimate: 8
    health: STALE
```

---

### F010 — GForge Integration
```yaml
id: F010
name: GForge Integration
status: PLANNED  # no spec dir
sp_estimate: 5
health: STALE
rework_count: 0
artifacts:
  spec: false
  plan: false
  tasks: false
  runs: 0
notes: >
  Unified Pulse + Compression dashboard across repos.
  No implementation, no spec directory. Late-wave feature.
dependencies:
  - F006
  - F007
phases:
  - id: F010-P1
    name: Unified Dashboard
    status: PLANNED
    sp_estimate: 5
    health: STALE
```

---

### F011 — Harvest
```yaml
id: F011
name: Harvest (Done, Done!)
status: DEFINED  # spec + plan + tasks exist, no implementation
sp_estimate: 5
health: BLOCKED  # depends on F002 (webhook handler), F003, F004
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 7  # define runs only
notes: >
  Post-merge lifecycle. Triggered by GitHub webhook on Phase Rollup PR merge.
  Spec/plan/tasks exist. 7 define runs. No ship/implementation runs.
  T001 updated for F014 compression schema (1a29976).
  **Needed by F018:** harvest:done → verify trigger for build plan drift check.
dependencies:
  - F002
  - F003
  - F004
phases:
  - id: F011-P1
    name: Merge Webhook Handler
    status: DEFINED
    sp_estimate: 2
    health: BLOCKED
  - id: F011-P2
    name: Log Finalization + Compression
    status: DEFINED
    sp_estimate: 2
    health: BLOCKED
  - id: F011-P3
    name: Done-Done Slack Notification
    status: DEFINED
    sp_estimate: 1
    health: BLOCKED
```

---

### F012 — Knowledge Work
```yaml
id: F012
name: Knowledge Work
status: PLANNED  # NO spec, no plan, no tasks
sp_estimate: 13
health: STALE
rework_count: 0
artifacts:
  spec: false  # !! no spec.md despite being in build plan
  plan: false
  tasks: false
  runs: 0
notes: >
  First-class Discovery pillar support. Fieldnote capture, discovery compilation.
  **No spec directory exists** despite being listed in build plan.
  Build plan describes gwrk discover, gwrk kw commands but nothing is implemented.
  Depends on F014 for domain plugin interface.
dependencies:
  - F001
  - F014
phases:
  - id: F012-P1
    name: Fieldnote Capture + SQLite
    status: PLANNED
    sp_estimate: 5
    health: STALE
  - id: F012-P2
    name: Discovery Compilation
    status: PLANNED
    sp_estimate: 3
    health: STALE
  - id: F012-P3
    name: KW Workflow Commands
    status: PLANNED
    sp_estimate: 5
    health: STALE
```

---

### F013 — Agent-Native Interface
```yaml
id: F013
name: Agent-Native Interface
status: DONE
sp_estimate: 28
sp_actual: 28
health: CLEAN
completed_at: "2026-03-13"
hardened: true
rework_count: 0
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 6
notes: >
  Dual-mode CLI for humans and agents. withSignal(), --format json, --agent mode,
  gwrk project discover/specs/gates, gwrk gate-check, exit code standardization.
  ADR-004 (agent-native output protocol). Foundational for F004 and F014.
src_files:
  - src/utils/signal.ts
  - src/utils/output.ts
  - src/utils/agent-layer.ts
  - src/commands/gate-check.ts
  - src/commands/project.ts
  - src/engine/discover.ts
  - src/engine/classify.ts
phases:
  - id: F013-P1
    name: Foundation (withSignal, --format json, gate-check)
    status: DONE
    sp_estimate: 7
    health: CLEAN
  - id: F013-P2
    name: Discovery (project discover, specs, gates)
    status: DONE
    sp_estimate: 10
    health: CLEAN
  - id: F013-P3
    name: Agent Mode (--agent, Layer 2)
    status: DONE
    sp_estimate: 11
    health: CLEAN
```

---

### F014 — Plugin System
```yaml
id: F014
name: Plugin System (L1-L2)
status: SHIPPED  # L1+L2 shipped, L2.5 (WorkflowRuntime) never implemented
sp_estimate: 20
sp_actual: 20  # L1+L2 only
health: DRIFTED  # Build plan claims ✅ but L2.5 is missing entirely
completed_at: "2026-03-17"  # L1+L2 PR merged
hardened: false  # tests exist but multiple hotfix iterations during ship attempts
rework_count: 3  # PR #15/16 reverted, re-merged, then F014-R rework initiated
artifacts:
  spec: true
  plan: true
  tasks: true
  runs: 14  # most active feature
notes: >
  Three-layer plugin architecture. L1 (Agent Backends) and L2 (Skills) shipped.
  L2.5 (WorkflowRuntime) specified but NEVER BUILT — all CLI commands still
  hardcode .agents/workflows/ paths. This is the shareability blocker.
  PR #15 and #16 were reverted and re-merged (32b26ad, 49e7d0a, 5517f8f).
  Multiple hotfix commits during ship attempts (5f09540, 47432cd, 717fe1b, aa1e15a, f726967).
  **F014-R created as rework addendum for L2.5.**
src_files:
  - src/plugins/loader.ts
  - src/plugins/manifest.ts
  - src/plugins/registry.ts
  - src/plugins/skill-runtime.ts
  - src/plugins/seed.ts
  - src/plugins/migrate.ts
  - src/commands/plugin.ts
  - src/commands/skill.ts
  - src/commands/sync-context.ts
phases:
  - id: F014-P1
    name: Plugin Loader + Registry
    status: DONE
    sp_estimate: 5
    health: CLEAN
  - id: F014-P2
    name: Skill Runtime
    status: DONE
    sp_estimate: 5
    health: CLEAN
  - id: F014-P3
    name: Agent Backend Adapters
    status: DONE
    sp_estimate: 5
    health: CLEAN
  - id: F014-P4
    name: Routing Intelligence (ex-F008)
    status: DONE
    sp_estimate: 5
    health: CLEAN
```

---

### F014-R — WorkflowRuntime Rework
```yaml
id: F014-R
name: WorkflowRuntime Rework (Shareability Blocker)
status: IN_PROGRESS  # P4 (schema validation, type safety) shipped, P5-P7 pending
sp_estimate: 30  # mid-range of 25-40
health: BLOCKED  # partially implemented but critical path
rework_count: 4  # P4 took 4+ iterations to land
artifacts:
  spec: true  # rework addendum in 014-plugin-system/spec.md
  plan: true  # 7 phases
  tasks: true  # 43 tasks
  runs: 14  # shared with F014
notes: >
  Implement Layer 2.5 that F014 specified but never built.
  WorkflowRuntime engine, JSON intent parser, 10 builtin workflows,
  CLI command rewiring, gwrk init overhaul, DefineOrchestrator.
  P4 (schema validation, type safety, test isolation) landed after 4+ iterations
  of hotfixes (ed75d5f). P5 (CLI rewiring) is the true shareability blocker.
  **Critical path item.** User deleted intent-engine.ts and workflow-runtime.ts
  from feature branch — status uncertain post-deletion.
dependencies:
  - F014
phases:
  - id: F014-R-P1
    name: WorkflowRuntime Engine
    status: DEFINED
    sp_estimate: 5
    health: BLOCKED
  - id: F014-R-P2
    name: Builtin Workflow Plugins
    status: DEFINED
    sp_estimate: 5
    health: BLOCKED
  - id: F014-R-P3
    name: JSON Intent Engine
    status: DEFINED
    sp_estimate: 3
    health: BLOCKED
  - id: F014-R-P4
    name: Schema Validation + Type Safety
    status: SHIPPED  # ed75d5f
    sp_estimate: 3
    sp_actual: 8  # 4+ iterations
    health: DRIFTED  # files deleted by user
  - id: F014-R-P5
    name: CLI Command Rewiring
    status: DEFINED
    sp_estimate: 5
    health: BLOCKED
  - id: F014-R-P6
    name: gwrk init Overhaul
    status: DEFINED
    sp_estimate: 5
    health: BLOCKED
  - id: F014-R-P7
    name: Governance Defaults as Builtins
    status: DEFINED
    sp_estimate: 4
    health: BLOCKED
```

---

### F015 — Event Bus & Scheduler
```yaml
id: F015
name: Event Bus & Scheduler
status: PLANNED  # no spec dir
sp_estimate: 8
health: STALE
rework_count: 0
artifacts:
  spec: false
  plan: false
  tasks: false
  runs: 0
notes: >
  WebSocket event bus on build server + cron scheduler.
  No spec directory, no implementation. Described only in build plan.
dependencies:
  - F002
phases:
  - id: F015-P1
    name: WebSocket Event Bus
    status: PLANNED
    sp_estimate: 5
    health: STALE
  - id: F015-P2
    name: Cron Scheduler
    status: PLANNED
    sp_estimate: 3
    health: STALE
```

---

### F016 — Domain Packs
```yaml
id: F016
name: Domain Packs
status: PLANNED  # no spec dir
sp_estimate: 13
health: STALE
rework_count: 0
artifacts:
  spec: false
  plan: false
  tasks: false
  runs: 0
notes: >
  Domain-specific plugin packs for Knowledge Work.
  No spec directory, no implementation. Late-wave feature.
dependencies:
  - F012
  - F014
phases:
  - id: F016-P1
    name: Domain Plugin Interface
    status: PLANNED
    sp_estimate: 5
    health: STALE
  - id: F016-P2
    name: Core Domain Packs (4)
    status: PLANNED
    sp_estimate: 8
    health: STALE
```

---

### F017 — Channel Abstraction
```yaml
id: F017
name: Channel Abstraction
status: PLANNED  # no spec dir
sp_estimate: 8
health: STALE
rework_count: 0
artifacts:
  spec: false
  plan: false
  tasks: false
  runs: 0
notes: >
  ChannelPlugin interface to decouple comms from Slack.
  No spec directory, no implementation. Late-wave feature.
dependencies:
  - F014
  - F015
  - F003
phases:
  - id: F017-P1
    name: ChannelPlugin Interface
    status: PLANNED
    sp_estimate: 5
    health: STALE
  - id: F017-P2
    name: Slack Refactor to Plugin
    status: PLANNED
    sp_estimate: 3
    health: STALE
```

---

### F018 — Build Plan Orchestrator
```yaml
id: F018
name: Build Plan Orchestrator
status: SPECIFIED  # spec just created by gwrk define spec
sp_estimate: 25
health: CLEAN
rework_count: 0
artifacts:
  spec: true  # just created
  plan: false
  tasks: false
  runs: 0
notes: >
  Build plan as a solvable DAG. SQLite graph storage, graphology solver,
  CPM critical path, ready queue, event hooks, drift detection, sigma.js viz.
  Spec created 2026-04-02 via gwrk define spec. Plan and tasks pending.
  **P1+P2 ships before F014-R-P5** (PM decision).
dependencies: []  # P1 has no dependencies
phases:
  - id: F018-P1
    name: Data Model + Seed
    status: SPECIFIED
    sp_estimate: 5
    health: CLEAN
  - id: F018-P2
    name: Solver + CLI
    status: PLANNED
    sp_estimate: 5
    health: CLEAN
  - id: F018-P3
    name: Graph Mutation
    status: PLANNED
    sp_estimate: 5
    health: CLEAN
  - id: F018-P4
    name: Event Hooks + Verify + Render
    status: PLANNED
    sp_estimate: 5
    health: CLEAN
  - id: F018-P5
    name: Viz + Heartbeat + Governance
    status: PLANNED
    sp_estimate: 5
    health: CLEAN
```

---

## Dependency Edges

```yaml
edges:
  # Foundation
  - { from: F001, to: F000, type: DEPENDS_ON }
  - { from: F013, to: F001, type: DEPENDS_ON }
  - { from: F002, to: F001, type: DEPENDS_ON }
  - { from: F014, to: F001, type: DEPENDS_ON }

  # TDD + Ship
  - { from: F000-TDD, to: F013, type: DEPENDS_ON }
  - { from: F004, to: F013, type: DEPENDS_ON }
  - { from: F004, to: F000-TDD, type: DEPENDS_ON }

  # Server branch
  - { from: F003, to: F002, type: DEPENDS_ON }

  # F014 rework chain
  - { from: F014-R, to: F014, type: DEPENDS_ON }
  - { from: F004-R, to: F014-R, type: DEPENDS_ON }

  # Post-F014-R
  - { from: F005, to: F002, type: DEPENDS_ON }
  - { from: F005, to: F004, type: DEPENDS_ON }
  - { from: F005, to: F014-R, type: DEPENDS_ON }

  # Harvest
  - { from: F011, to: F002, type: DEPENDS_ON }
  - { from: F011, to: F003, type: DEPENDS_ON }
  - { from: F011, to: F004, type: DEPENDS_ON }

  # Independent off F001
  - { from: F006, to: F001, type: DEPENDS_ON }
  - { from: F007, to: F001, type: DEPENDS_ON }

  # Late wave
  - { from: F009, to: F003, type: DEPENDS_ON }
  - { from: F010, to: F006, type: DEPENDS_ON }
  - { from: F010, to: F007, type: DEPENDS_ON }
  - { from: F012, to: F001, type: DEPENDS_ON }
  - { from: F012, to: F014, type: DEPENDS_ON }
  - { from: F015, to: F002, type: DEPENDS_ON }
  - { from: F016, to: F012, type: DEPENDS_ON }
  - { from: F016, to: F014, type: DEPENDS_ON }
  - { from: F017, to: F014, type: DEPENDS_ON }
  - { from: F017, to: F015, type: DEPENDS_ON }
  - { from: F017, to: F003, type: DEPENDS_ON }

  # F018 internal
  - { from: F018-P2, to: F018-P1, type: DEPENDS_ON }
  - { from: F018-P3, to: F018-P1, type: DEPENDS_ON }
  - { from: F018-P4, to: F018-P2, type: DEPENDS_ON }
  - { from: F018-P4, to: F018-P3, type: DEPENDS_ON }
  - { from: F018-P5, to: F018-P4, type: DEPENDS_ON }
  - { from: F018-P5, to: F002, type: DEPENDS_ON }  # build server for viz/cron
  - { from: F018-P5, to: F003, type: DEPENDS_ON }  # slack for heartbeat

  # Invalidation edges (from rework/research)
  - { from: F014-R, to: F014-R-P4, type: INVALIDATES }  # user deleted implementation files
```

---

## Summary Statistics

| Category | Count |
|---|---|
| Total features (incl. retired) | 19 |
| Active features | 17 |
| DONE | 5 (F000, F000-TDD, F004, F013, F014 L1-L2) |
| SHIPPED (not hardened) | 3 (F001, F002, F003) |
| SPECIFIED/DEFINED | 4 (F005, F006, F007, F011) |
| IN_PROGRESS | 1 (F014-R) |
| PLANNED (no spec) | 4 (F009, F010, F015, F016, F017) |
| SPECIFIED (just created) | 1 (F018) |
| RETIRED | 1 (F008) |
| STALE (no activity) | 7 |
| DRIFTED (claimed ≠ actual) | 3 (F003, F004, F014) |
| BLOCKED | 4 (F004-R, F005, F011, F014-R) |
| Total SP estimated | ~258 |
| SP completed (actual) | ~109 |
| SP remaining | ~149 |
| Total rework commits | ~30 |
| Test files | 92 |
