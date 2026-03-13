# 000 Build Plan — gwrk

> **Status:** Authoritative · **Date:** 2026-03-10 (v6)
> **Anchored to:** [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md), [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md)
> **Decisions:** [ADR-001](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md) (gate architecture), [ADR-002](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md) (SQLite execution ledger), [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) (execution state contract)

---

## Dependency Graph

```mermaid
graph TD
    P0[Phase 0: Extraction] --> P1[Phase 1: CLI Core]
    P1 --> P2[Phase 2: Build Server]
    P1 --> P4[Phase 4: Ship Loop]
    P2 --> P3[Phase 3: Slack + App Home Tab]
    P2 --> P5[Phase 5: Parallel Dispatch]
    P4 --> P5
    P1 --> P6[Phase 6: Pulse]
    P1 --> P7[Phase 7: Effort + Compression]
    P5 --> P8[Phase 8: Multi-Agent Router]
    P3 --> P9[Phase 9: Agent-DUT]
    P6 --> P10[Phase 10: GForge Integration]
    P7 --> P10
    P1 --> P12[Phase 12: Knowledge Work]
```

---

## Critical Path

```
P0 → P1 → P2 → P3 (+ App Home Tab)
              → P4 → P5 → P8
         → P6
         → P7
```

**P1 (CLI Core) is the keystone.** Everything depends on the CLI command infrastructure, multi-CLI provisioning, and the SQLite execution ledger (ADR-002). P2 (Build Server) and P4 (Ship Loop) are the next-order dependencies. P3 is Slack (Socket Mode + Bolt SDK) + App Home Tab (folded from former P11, replacing Telegram). P9 (Agent-DUT) depends on a fully functioning P3.

---

## Phases

### Phase 0 — Extraction ✅

Extract the code-red agent workflow system into the gwrk repository.

| Feature | Content | Gate |
|---|---|---|
| `.agents/` | Workflows, rules, personas, templates | Files exist |
| `.specify/` | Templates, scripts, memory | Files exist |
| `scripts/dev/` | Shell orchestrators | `make agent-specify` runs |
| `Makefile` | Agent invocation targets | Targets fire |

**Status:** Complete. Committed on `develop`.

---

### Phase 1 — CLI Core

Bootstrap the gwrk TypeScript CLI with foundational commands, multi-CLI provisioning, and the SQLite execution ledger (ADR-002).

| Spec | Content | Gate |
|---|---|---|
| `001-cli-core` | CLI entry, Commander routing, `gwrk new`, `gwrk init`, multi-CLI provisioning, `specify`, `plan`, `plan-to-tasks`, `tasks`, SQLite init | `gwrk new <project>` scaffolds everything; `gwrk tasks done` enforces gates |

**Dependencies:** Phase 0
**Agent:** Gemini CLI (definition + multi-file generation)

#### What ships:

```bash
gwrk new <project-name>        # Full provisioning: dir, git, GitHub, Slack channel,
                                # CLI detection, scaffold, SQLite registration, server start
gwrk init                      # Add gwrk to existing project: scaffold + CLI provisioning
                                # + Slack channel + SQLite registration
gwrk specify <feature>         # Wrapper: invokes gemini with /specify workflow
gwrk plan <feature>            # Wrapper: invokes gemini with /plan workflow
gwrk tasks <feature>           # List tasks from SQLite (exported to .gwrk/tasks.json)
gwrk tasks done <feature> <id> # Gate-enforced state transition
```

#### `gwrk new` vs `gwrk init`:
- **`gwrk new <name>`** — From scratch. Requires explicit project name (or description → extracted name). Creates directory, `git init`, `gh repo create`, Slack channel, full scaffold, CLI provisioning, SQLite registration. Does everything it can, then reports what it couldn't with next steps.
- **`gwrk init`** — "I'm working here, add gwrk." Detects existing project context. Scaffolds `.agents/`, `.specify/`, `specs/`. Provisions detected CLIs (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`). Creates Slack channel. Registers in SQLite.

#### Multi-CLI provisioning:
- Detects `gemini`, `claude`, `codex` via `which`/`command -v`
- Provisions CLI-specific context files referencing shared `.agents/` directory
- Generates CLI-specific settings from `.gwrkrc.json` defaults

#### Key files:
- `src/cli.ts` — Commander entry point
- `src/commands/new.ts` — Full project provisioning
- `src/commands/init.ts` — Add gwrk to existing project
- `src/commands/specify.ts`, `plan.ts`, `tasks.ts`
- `src/utils/exec.ts` — Shell command runner
- `src/utils/config.ts` — `.gwrkrc.json` loader (Zod, fail-fast)
- `src/db/index.ts` — SQLite connection + schema init
- `src/db/migrations/` — Versioned schema files
- `src/utils/state.ts` — Task read/write via SQLite
- `src/utils/history.ts` — History inserts via SQLite
- `src/utils/parser.ts` — Extract phases/tasks from `plan.md`
- `src/utils/gate-gen.ts` — Generate `gates/T0xx-gate.sh` from contracts

#### Tech decisions:
- **Commander.js** for CLI routing (not Ink — see architecture.md §4)
- **better-sqlite3** for execution ledger (ADR-002)
- **Zod** for all schema validation
- **Vitest** for testing
- **Biome** for lint + format
- **ES2022** target, ESM modules

---

### Phase 2 — Build Server

Local persistent daemon that serves as the control plane. Includes macOS sleep/wake resilience, network connectivity awareness, and component-level health reporting.

| Spec | Content | Gate |
|---|---|---|
| `002-build-server` | Fastify daemon, dispatch queue, Docker sandbox manager, sleep/wake lifecycle, network monitor, rich health endpoint, **`gwrk harvest` manifest ETL** | `gwrk server start` creates sandboxes; dispatch queue pauses on sleep/offline; harvest upserts manifests into SQLite |

**Dependencies:** Phase 1
**Agent:** Claude Code (long-context server architecture)

#### What ships:

```bash
gwrk server start              # Start localhost:18790 daemon
gwrk server stop               # Stop daemon
gwrk status                    # Active agents, clones, system resources
```

#### Key files:
- `src/server/index.ts` — Fastify bootstrap
- `src/server/dispatch.ts` — Phase dispatch queue + retry logic (writes to `runs` table)
- `src/server/sandbox.ts` — Docker container lifecycle
- `src/server/git-manager.ts` — Branch creation, merge, conflict resolution

---

### Phase 3 — Slack

Slack integration for the comms layer via Socket Mode + Bolt SDK. Channel-per-project model.

| Spec | Content | Gate |
|---|---|---|
| `003-slack` | Socket Mode app, Bolt SDK, slash commands, interactive messages, threads, channel provisioning, **App Home Tab dashboard** | Send status update and approve a review verdict from Slack; App Home Tab renders live dashboard |

**Dependencies:** Phase 2
**Agent:** Gemini CLI

#### What ships:

```bash
gwrk setup slack               # Fully automated: create app, install, write tokens, test
# Slack commands: /gwrk status, /gwrk dispatch, /gwrk approve, /gwrk pulse
# Interactive: review verdict buttons, threaded DUT conversations
# Reactions: ✅ react-to-approve for lightweight confirmation
# Presence: notification throttling (active=verbose, away=batched)
```

#### Key files:
- `src/server/slack.ts` — Bolt SDK Socket Mode integration
- `src/server/slack-commands.ts` — Slash command handlers
- `src/server/slack-actions.ts` — Interactive message action handlers
- `src/commands/setup-slack.ts` — Automated Slack app provisioning

---

### Phase 4 — Ship Loop

Autonomous implement → review → PR → CI loop. (Renamed from WUD to align with Foxtrot Charlie Pillar 3: Shipping.)

| Spec | Content | Gate |
|---|---|---|
| `004-ship-loop` | `gwrk ship`, review gates, PR creation, execution manifests, run recording | Agent completes a phase and opens a PR |

**Dependencies:** Phase 1
**Agent:** Codex Cloud (autonomous execution)

#### What ships:

```bash
gwrk ship <feature> [phase]        # Full autonomous lifecycle (phase optional — ships all if omitted)
gwrk ship <feature> <phase>        # Ship a single phase
```

#### SQLite integration:
- Every Ship dispatch writes a `runs` record (backend, model, attempt, timestamps)
- Gate results recorded in `runs.gate_result`
- Review verdicts in `runs.review_verdict`
- Retry reasons in `runs.retry_reason`

---

### Phase 5 — Parallel Dispatch

Multi-phase concurrent execution with conflict resolution.

| Spec | Content | Gate |
|---|---|---|
| `005-parallel-dispatch` | Concurrent sandboxes, merge ordering, managed repo clones, **per-backend capacity gate** | Three agents work simultaneously without exceeding backend rate limits |

**Dependencies:** Phase 2, Phase 4
**Agent:** Claude Code

#### What ships:

```bash
gwrk feature <feature>         # Full end-to-end lifecycle
gwrk config set parallelism.local.clones 3
```

#### Agent capacity gate:
- Before `processNext()` assigns a backend, checks: (a) is backend at `maxConcurrent`? (b) hit `rateLimit` in sliding window? → skip to next in `fallbackOrder`
- On 429/rate-limit error: record in `runs`, exponential backoff with jitter on that backend
- See [agent-backends.md](file:///Users/gonzo/Code/gwrk/docs/references/agent-backends.md) for per-backend constraints

---

### Phase 6 — Pulse

Productivity dashboard with historical git analysis.

| Spec | Content | Gate |
|---|---|---|
| `006-pulse` | Git log scanner, PulseSnapshot, historical scan | `gwrk pulse scan` produces data |

**Dependencies:** Phase 1
**Agent:** Gemini CLI

#### What ships:

```bash
gwrk pulse                     # Current snapshot across repos
gwrk pulse scan [path]         # Scan any existing git repo
```

---

### Phase 7 — Effort + Compression

SP-driven estimation and delivery speed measurement with leading compression indicators.

| Spec | Content | Gate |
|---|---|---|
| `007-effort-compression` | Story extraction, role bracketing, timestamp collection, compression ratios, leading indicators: convergence (first-pass rate, avg attempts), density (lines/SP, files/SP, tool calls/SP), spec quality (contract count, gate count) | `gwrk compression` produces a report with Point + Total ratios and leading indicators |

**Dependencies:** Phase 1, SQLite (ADR-002)
**Agent:** Gemini CLI

#### What ships:

```bash
gwrk effort <feature>          # Generate effort estimate from spec stories
gwrk compression <feature>     # Compression ratios + leading indicators
gwrk compression --all         # Summary across all features with trends
```

#### SP additivity invariant:
Feature SP = Σ Phase SP = Σ Task SP. No orphan points. gwrk validates on `plan-to-tasks`.

---

### Phase 8 — Multi-Agent Router

Agent backend selection, Done Done! protocol, retry + escalation, learning from execution history. **Agent registry with per-backend rate/token limits.**

| Spec | Content | Gate |
|---|---|---|
| `008-agent-router` | Router logic, per-backend invocation, fallback chain, tandem dispatch, **SQLite-backed learning**, **agent registry schema**, **context size estimator** | Dispatch to Codex, retry on Claude, mini-model fallback, feature ships |

**Dependencies:** Phase 5, SQLite (ADR-002)
**Agent:** Claude Code

#### Agent registry:
- `.gwrkrc.json` → `agents.registry` map. Each backend declares: `contextWindow`, `maxConcurrent`, `rateLimit`, `models[]`, `invocation` command template
- Context Size Estimator: rough token count for `phase-context.md` vs backend's `contextWindow`. Too large → skip backend
- Mini-model fallback: if primary at capacity, try mini variant (e.g., `gpt-5.1-codex-mini`) before escalating
- See [agent-backends.md](file:///Users/gonzo/Code/gwrk/docs/references/agent-backends.md) for documented constraints

#### Learning engine:
- Queries global SQLite `runs` + `task_types` tables
- Selects backend based on historical success rate × task SP × language
- Adapts over time as more execution data accumulates

---

### Phase 9 — Agent-DUT

Slack-native conversational ideation → spec generation, aligned to Foxtrot Charlie.

| Spec | Content | Gate |
|---|---|---|
| `009-agent-dut` | DUT conversational loop in Slack threads, FC-aligned protocol (SPARK→PROBE→DISAMBIGUATE→SHAPE→PRESS→GROUND→REVIEW→COMMIT), analyze-as-core-perspective | `/dream` in Slack produces a `spec.md` from threaded conversation |

**Dependencies:** Phase 3
**Agent:** Gemini CLI

#### Foxtrot Charlie alignment:
- **Discovery (Truth):** SPARK → PROBE → DISAMBIGUATE (analyze lens active)
- **Definition (Clarity):** SHAPE → PRESS → GROUND → REVIEW → COMMIT
- Analyze perspective runs continuously, not as a separate step

---

### Phase 10 — GForge Integration

Unified Pulse + Compression dashboard across repos.

| Spec | Content | Gate |
|---|---|---|
| `010-gforge-integration` | Pulse replaces PulseStore, unified dashboard | Single pane across repos |

**Dependencies:** Phase 6, Phase 7

---

### Phase 11 — RETIRED

> **Folded into Phase 3 (003-slack).** The App Home Tab is a Bolt event handler + Block Kit renderer that shares the same Bolt instance, OAuth scopes, and config as the rest of 003-slack. Keeping it separate added overhead for minimal isolation benefit. See US-008/FR-008 in `specs/003-slack/spec.md`.

---

### Phase 12 — Knowledge Work

First-class support for Foxtrot Charlie's Discovery pillar. Fieldnote capture, discovery compilation, and knowledge work workflows (kw-specify, kw-plan, kw-build-plan) as gwrk commands.

| Spec | Content | Gate |
|---|---|---|
| `012-knowledge-work` | `gwrk discover`, `gwrk kw`, fieldnotes, discovery digest, kw-specify/plan/build-plan, datetime orientation, SQLite `fieldnotes` table | `gwrk discover fieldnote` captures from stdin; `gwrk kw specify` produces `kw-spec.md` |

**Dependencies:** Phase 1
**Agent:** Gemini CLI

#### What ships:

```bash
gwrk discover fieldnote            # Capture fieldnote from stdin/file/URL
gwrk discover compile              # Assemble discovery digest
gwrk discover list                 # List fieldnotes with recency indicators
gwrk kw specify <deliverable>      # Knowledge work specification
gwrk kw plan <deliverable>         # Knowledge work execution plan
gwrk kw build-plan                 # Manage 000-deliverables-plan.md
```

#### Datetime orientation:
- Every fieldnote carries: `createdAt`, `sourceDate`, `source`, `project`, `tags`, `supersedes`
- Files stored as `docs/discovery/fieldnotes/YYYY-MM-DD-{slug}.md` with YAML frontmatter
- SQLite `fieldnotes` table enables recency queries, burst detection, staleness warnings
- `--since <date>` and `--stale <days>` filters on `discover list`

#### Discovery directory convention:
- `docs/discovery/fieldnotes/` — timestamped fieldnotes
- `docs/discovery/references/` — primary/secondary reference materials
- `docs/deliverables/` — knowledge work deliverable directories
- Provisioned by `gwrk init`

---

## Wave Strategy

| Wave | Phases | Parallelizable? | Theme |
|---|---|---|---|
| **Wave 1** | P1 | No (keystone) | Bootstrap: CLI, SQLite, multi-CLI provisioning, gwrk new/init |
| **Wave 2** | P2, P4, P6, P7, P12 | Yes (independent after P1) | Core engines: server, execution, productivity, compression, discovery |
| **Wave 3** | P3, P5 | Partially (P3 needs P2, P5 needs P2+P4) | Multipliers: Slack + App Home Tab, parallelism |
| **Wave 4** | P8, P9 | Yes (P8 needs P5; P9 needs P3) | Intelligence + Comms: smart routing, DUT ideation |
| **Wave 5** | P10 | No (needs P6+P7) | Integration: unified dashboard |

---

## Estimated Effort

| Phase | SP | Primary Role | Est. Hours |
|---|---|---|---|
| P0 (Extraction) | 3 | PE | Done |
| P1 (CLI Core) | 25 | TS | 125h |
| P2 (Build Server) | 18 | TS | 90h |
| P3 (Slack + App Home Tab) | 13 | TS | 65h |
| P4 (Ship Loop) | 8 | TS | 40h |
| P5 (Parallel Dispatch) | 10 | TS | 50h |
| P6 (Pulse) | 5 | TS | 25h |
| P7 (Effort + Compression) | 8 | TS | 40h |
| P8 (Agent Router) | 10 | TS | 50h |
| P9 (Agent-DUT) | 8 | TS | 40h |
| P10 (Integration) | 5 | TS | 25h |
| P11 (RETIRED) | — | — | Folded into P3 |
| P12 (Knowledge Work) | 8 | TS | 40h |
| **Total** | **121 SP** | | **590h** |

**Changes from v1:** P1 increased (13→21 SP: gwrk new, gwrk init, multi-CLI, SQLite). P3 increased (8→13 SP: Slack is richer than Telegram). P7 increased (5→8 SP: leading indicators). P11 decreased (8→5 SP: App Home Tab is simpler than SPA).

---

## Open Questions Blocking Architecture

None for P0→P1→P2 critical path. Remaining questions:

| # | Question | Affects | Status |
|---|---|---|---|
| 1 | SP → Phase → Task additivity enforcement: warn or hard fail? | P7 | 🟡 Open |
| 2 | Cloudflare Tunnel automation: can we provision without pre-config? | P11 | 🟡 Open (spike needed) |
| 3 | Slack presence throttling: granularity beyond active/away? | P3 | 🟡 Open |

---

## Changelog

- **2026-03-10 (v6):** P11 (App Home Tab) retired as separate phase — folded into P3 (003-slack). App Home Tab is US-008/FR-008 within 003-slack. DUT scope (US-006/FR-006/TR-008/DM-004) extracted from 003-slack → deferred to 009-agent-dut. P9 depends on fully functioning P3. Wave 4 reduced to P8+P9. SP: 126→121 (-5 SP from retired P11). Hours: 615h→590h.
- **2026-03-08 (v5):** Execution State Contract (ADR-003). Two-tier architecture: git-native execution manifests (Tier 1, operational) + build-server-side SQLite harvest (Tier 2, analytical). `.gitignore` for `.runs/`, `.gitattributes` for `.gwrk/` merge safety. P1 gains Phase 9 (manifest writer, `tasks verify`, `history.jsonl` deprecation path). P2 gains `gwrk harvest`. P1 SP: 21→25. `history.jsonl`(DM-002) deprecated. Total: 122→126 SP.
- **2026-03-08 (v4):** Three additions. (1) Phase 4 renamed WUD→Ship to align with FC Pillar 3. (2) Agent Registry: P5 gets capacity gate (per-backend rate limiting), P8 gets registry schema + context size estimator + mini-model fallback. Backend constraints documented in `docs/references/agent-backends.md`. P5 SP: 8→10, P8 SP: 8→10. (3) New Phase 12 (Knowledge Work): first-class Foxtrot Charlie Discovery pillar support — fieldnote capture, discovery compilation, kw-specify/plan/build-plan. Wave 2 eligible. +8 SP. Total: 110→122 SP.
- **2026-03-08 (v3):** Added resilience requirements to Phase 2 (Build Server). New user scenarios: US-011 (macOS sleep/wake), US-012 (network connectivity), US-013 (rich health). Seven new FRs (FR-015–FR-021). New Phase 6 in 002-build-server plan (Resilience & Connectivity). Phase 11 tunnel dependency on Phase 2 event bus clarified. P2 SP: 13→18 (+5 SP for resilience phase). Total: 105→110 SP.
- **2026-03-05 (v2):** Major update per strategic vision v2. Phase 3: Telegram → Slack (Socket Mode + Bolt SDK). Phase 11: Glass Dashboard → App Home Tab. P1 expanded (gwrk new/init, multi-CLI provisioning, SQLite). SQLite execution ledger (ADR-002) replaces flat JSON. P7 adds leading compression indicators. P9 DUT moves to Slack, aligns to Foxtrot Charlie. Telegram cut from MVP. Updated SP estimates. Total: 92→105 SP.
- 2026-02-27: Added Spec 011 (Glass Dashboard). Wave 4. Dependencies: [P2, P3]. Impact: +8 SP.
