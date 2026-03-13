# gwrk — Unified PR/FAQ & Product Requirements Document

> **Version:** 2.4 · **Date:** 2026-04-01
> **Status:** Product Definition — Pre-Implementation
> **Author:** David "Gonzo" Gonzalez · **Org**: GForge ESC

---

## Table of Contents

1. [Press Release](#1-press-release)
2. [Frequently Asked Questions](#2-frequently-asked-questions)
3. [Product Context & Problem Statement](#3-product-context--problem-statement)
4. [The Origin Story: Extraction from Code-Red & GForge.ai](#4-the-origin-story)
5. [Architecture Vision](#5-architecture-vision)
6. [The Principal Engineer Thesis](#6-the-principal-engineer-thesis)
7. [Telegram: The Mobile Control Plane](#7-telegram-the-mobile-control-plane)
8. [The Multi-Agent Dispatch Engine](#8-the-multi-agent-dispatch-engine)
9. [Agent-DUT: Dream Until Told](#9-agent-dut-dream-until-told)
10. [Jobs To Be Done](#10-jobs-to-be-done)
11. [User Personas & Stories](#11-user-personas--stories)
12. [Core Components](#12-core-components)
13. [The gwrk Build Server (OpenClaw-Inspired)](#13-the-gwrk-build-server)
14. [Pulse: The Productivity Dashboard](#14-pulse-the-productivity-dashboard)
15. [Effort Estimation Engine](#15-effort-estimation-engine)
16. [Compression: The Core Metric](#16-compression-the-core-metric)
17. [Functional Requirements](#17-functional-requirements)
18. [Technology Stack](#18-technology-stack)
19. [Competitive Landscape](#19-competitive-landscape)
20. [Pricing & GTM](#20-pricing--gtm)
21. [Story Map & Story Points](#21-story-map--story-points)
22. [Success Metrics](#22-success-metrics)
23. [Open Questions](#23-open-questions)

---

# 1. Press Release

## Introducing gwrk: Your Principal Engineer Never Sleeps

**FOR IMMEDIATE RELEASE: April 1, 2026**

Today, GForge ESC launched **gwrk** (pronounced "gee-work"), a CLI and build server that turns one experienced architect into a software factory — orchestrating fleets of AI coding agents through governed, parallelized pipelines while keeping you in control from your phone.

gwrk is not another AI code generator. It's the **Principal Engineer's operating system** — taking your architectural vision, decomposing it into executable phases, dispatching AI agents to build them in parallel, and driving the results through review gates, CI, and merge — all while reporting back to you on Slack.

> "I built gwrk because I kept doing the same thing across two codebases: writing specs, decomposing plans, dispatching agents, watching CI, resolving merge conflicts, reviewing code — all while trying to stay productive myself. gwrk is the extraction of that entire lifecycle into something you install in five minutes and control from your couch."
> — David Gonzalez, Technical Product Lead

**The core insight**: The scarce resource isn't code generation — it's *architectural judgment*. The better you are as a Principal Engineer and Architect, the better gwrk performs. gwrk replaces the cumbersome codebase comprehension pipeline with one that rewards real system-design skill.

gwrk introduces the **Agent-ZFG / Agent-WUD / Agent-DUT** model:

- **Agent-ZFG** ("Zero F*cks Given") is the local orchestrator. It plans, delegates, merges, and resolves. It runs on your laptop as a persistent daemon — inspired by OpenClaw's local Gateway. And it talks to you on **Slack** — sending status updates to your project channel, asking for approval on review verdicts, reporting CI failures, and accepting slash commands — so you never have to be at your desk to unblock the pipeline.

- **Agent-WUD** ("Work Until Done") is the ephemeral cloud worker. It receives a phase, writes code, runs tests, opens a PR, and terminates. Each instance runs in an isolated Docker sandbox, borrowing OpenClaw's proven sandbox model. And here's the key: **gwrk dispatches to whichever agent backend will get the job done** — Gemini CLI, Codex CLI, or Claude Code — running them in tandem, routing by task type, and retrying on a different backend if the first one fails. This is the OpenClaw ethos: maniacal commitment to completion.

- **Agent-DUT** ("Dream Until Told") is the ideation partner. It lives in Slack threads and turns your half-formed ideas — messages from a café, a 2am brainstorm — into structured specifications. You talk to it like a thought partner; it asks clarifying questions, proposes architecture, identifies risks, and ultimately produces a `spec.md` that feeds directly into the pipeline. **DUT → DUS → ZFG → WUD** — dream it in Slack, and gwrk builds it while you sleep.

gwrk ships with **Pulse** — a productivity dashboard that shows the *state of your work* across every repository you touch: published LOC on main, draft LOC on feature branches, weekly velocity trends, specification progress, and agent output — not server metrics, but a living portrait of what you've shipped, what's in progress, and what's defined. Point gwrk at any existing git repository and it generates a Pulse from the commit history, including historical trends back to the repo's creation.

But the headline number is **Compression** — gwrk's answer to "how much faster are we actually building?" Compression compares the effort forecast (story points × role-specific hours) against actual time evidenced in Git timestamps. A 39 SP feature estimated at 287 hours that ships in 45 minutes of active coding time has a **382× Point Compression ratio**. That's the number that tells you whether your architecture and your agents are actually working.

gwrk also ships with an **Effort Estimation Engine** — replacing the manual `/effort` workflow with automated story-point extraction, role-bracketed hour calculations, and effort reports that a contractor or team lead can hand to a client.

**Available now** as an MIT-licensed CLI. Build server requires Docker.

**Contact:** David Gonzalez · david@gforge.ai · github.com/gforge-esc/gwrk

---

# 2. Frequently Asked Questions

### What is gwrk?
gwrk is a CLI and local build server that orchestrates AI coding agents through a governed specification-to-delivery pipeline. It manages the full lifecycle: planning → task decomposition → parallel agent dispatch → code review → CI → merge. And it's reachable via Slack so you can oversee everything from your phone.

### Who is gwrk for?
Architects and experienced engineers who know how software should be structured but want to multiply their output. The core skill gwrk demands is **Principal Engineer judgment** — system decomposition, interface design, dependency ordering, and review rigor. The smarter you are at architecture, the better gwrk performs.

### How is gwrk different from just using an AI coding agent?
Individual agents write code. gwrk orchestrates *fleets*. It handles branching, parallel execution, merge conflict resolution, code review gates, CI monitoring, and audit trails. But more importantly — gwrk doesn't need you to sit at a terminal. It messages you on Slack when it needs a decision, sends you review summaries, and lets you approve or reject from your phone.

### Why Slack?
Because the bottleneck in automated development isn't code generation — it's *the human in the loop*. When an agent fails a review, hits a merge conflict, or CI goes red, the pipeline stalls until someone makes a decision. Slack means you can unblock that pipeline from anywhere — your couch, a restaurant, a walk — without opening a laptop. And unlike single-threaded messaging apps, Slack's channel-per-project model means you can manage multiple projects concurrently.

### Why extract this from Code-Red and GForge.ai?
We built 78 files and ~7,450 lines of workflow infrastructure across two production codebases. The infrastructure is project-agnostic — it works for a courtroom code forensics tool the same way it works for an epistemic publishing engine. Extraction means we maintain it once and benefit everywhere.

### What's the relationship to OpenClaw?
gwrk borrows three key architectural ideas from OpenClaw: (1) the **Gateway model** — a local daemon as the control plane; (2) the **sandbox model** — Docker-based per-session containers for isolated agent execution; and (3) the **comms channel** — giving the build server a conversational interface reachable from your phone. gwrk uses Slack (Socket Mode via `@slack/bolt`) as its native comms layer.

### What is Pulse and how is it different from server monitoring?
Pulse is NOT an observability/monitoring stack. It's a **productivity snapshot** — a dashboard that answers "what have I shipped, what's in progress, and what's defined?" across all your repositories. It tracks published LOC on main branches, draft LOC on feature/dev branches, weekly add/delete velocity, specification word counts, and effort estimates. Think of it as a portfolio view of your entire body of work, not a Grafana panel of CPU utilization.

### What is the App Home Tab?
The **App Home Tab** is gwrk's real-time dashboard, rendered natively in Slack via Block Kit. While Pulse answers "what have I built?", the App Home Tab answers **"what is the daemon doing right now?"** — active agents, dispatch queue, system resources, feature phase progress, and gate status. Slack slash commands handle actions; the App Home Tab handles *watching*.

### How do I see the dashboard from my phone?
Open the gwrk app in Slack — the App Home Tab is your live dashboard. For remote access to the build server itself, gwrk ships with a tunnel layer: `gwrk tunnel start` spins up a Cloudflare Tunnel or Tailscale Funnel connection.

### What is Compression?
Compression is gwrk's core metric. It compares the forecasted effort (from story points and role multipliers) against actual delivery time. There are two dimensions: **Point Compression** (estimated coding hours ÷ actual coding time from git commit activity) measures how fast agents wrote the code. **Total Compression** (estimated elapsed time ÷ actual wall-clock time from first implementation commit to merge) measures how fast the feature shipped end-to-end. gwrk tracks timestamps carefully: spec creation time, first commit, last commit, and merge — so a feature that sat dormant for 6 months but was pounded out in 45 minutes correctly shows the burst, not the dormancy.

### Can gwrk work with existing repositories?
Yes. `gwrk pulse scan` analyzes any existing git repository's commit history and generates a full Pulse snapshot with historical trends — weekly LOC buckets going back to the repository's creation. No gwrk-specific setup required for the scan.

### What does gwrk replace in my existing workflow?
If you use GForge.ai's codebase comprehension pipeline today, gwrk replaces it entirely. gwrk also replaces the manual `/effort` workflow for estimation. The workflow definitions (`.agents/workflows/`) and governance rules (`.agents/rules/`) become gwrk-managed artifacts that are portable across projects.

### Does gwrk replace my AI agent?
No. gwrk **uses all of them**. It dispatches to Gemini CLI, Codex CLI, and Claude Code — in tandem, routing tasks to the right backend based on the work. Codex for autonomous execution, Claude for long-context refactoring, Gemini for multi-file reasoning. If one agent fails a phase, gwrk retries with a different backend. Your agents are the workforce; gwrk is the general contractor.

### How does gwrk choose which agent to use?
gwrk ships with an **Agent Router** that selects backends based on task characteristics: code review goes to Codex (`codex review`), large refactors to Claude Code (deep context window), multi-file generation to Gemini CLI (parallel tool use). You can also pin a backend per-feature or per-phase in `.gwrkrc.json`. Over time, the router learns from compression ratios which backends perform best for which task types.

### Is gwrk opinionated about project structure?
Yes, productively so. gwrk expects a `specs/` directory for feature specifications, a `.agents/` directory for workflow definitions and governance rules, and a `.specify/` directory for templates and scripts. For existing repos without this structure, `gwrk init` scaffolds it.

### What is Agent-DUT?
Agent-DUT ("Dream Until Told") is gwrk's conversational ideation agent. It lives in Slack threads and turns your unstructured ideas into executable specs. You message it from your phone — text, sketches — and it asks clarifying questions, proposes system decomposition, identifies edge cases, and progressively refines your idea into a `spec.md`. When you say "ship it," DUT writes the spec, and the pipeline (ZFG → WUD) takes over. It's the bridge between "I had an idea on a walk" and "here's a PR."

---

# 3. Product Context & Problem Statement

## The Three-Part Problem

### Problem 1: Agents Write Code. Nobody Manages the Fleet.

AI coding agents can implement entire features. But the tooling treats each as a solo operator. There is no standard way to break a feature into parallelizable work, dispatch multiple agents simultaneously, manage Git branching automatically, resolve merge conflicts when parallel work collides, gate merges on review and CI, or maintain an audit trail.

### Problem 2: You Have to Be at Your Desk to Oversee.

The most expensive bottleneck in AI-assisted development is **the human approval loop**. When an agent fails code review, hits a CI failure, or produces a merge conflict, the pipeline stalls until you sit down at a terminal and make a decision. This is unacceptable when agents can work 24/7 but humans can't.

The solution is obvious from OpenClaw: make the build server **reachable from your phone**. Slack gives you a conversational interface to the entire pipeline — approve reviews, triage failures, dispatch new work — without opening a laptop.

### Problem 3: You Can't See What You've Built.

When you're shipping across multiple repositories — a courtroom forensics tool, an epistemic engine, client projects — there's no unified view of your productivity. GForge.ai built Pulse to solve this internally: a dashboard that shows published vs. draft content across epistemic categories (letters, research, courses, fieldnotes) alongside codebase metrics (weekly LOC added/deleted, total lines on main vs. draft branches).

But Pulse was hardwired to GForge.ai's data model. gwrk extracts and generalizes Pulse so any repository — new or existing — can generate a productivity snapshot from its Git history.

### Problem 4: Codebase Comprehension is Cumbersome.

GForge.ai's internal codebase comprehension pipeline — collecting metrics, aggregating snapshots, building series — requires a Prisma schema, a scheduler, API endpoints, and a web frontend. gwrk replaces this entire pipeline with `gwrk pulse scan`, which walks the Git log directly and produces a snapshot without any infrastructure.

## The gwrk Thesis

> **gwrk is a force multiplier for Principal Engineers.** It takes your architectural decomposition, distributes it to parallelized agent workers, and keeps you in the loop via Slack — so you ship features while walking the dog.
>
> The rarer your architectural skill, the more gwrk amplifies it.

---

# 4. The Origin Story

## Extraction from Two Production Codebases

gwrk is the **extraction and productization** of workflow infrastructure battle-tested across two real-world projects over six months:

### Code-Red: Courtroom Code Redline Tool
- **Architecture**: Rust kernel + TypeScript orchestration, Tauri desktop, SQLite
- **Workflow system**: 12 workflow definitions, 7 governance rules, 4 persona files, 3 agent templates
- **Key scripts**: `work-until-done.sh` (466 lines), `agent-run.sh` (352 lines), `define-until-solid.sh` (465 lines)
- **Governance**: Foxtrot Charlie — spec-first, no implementation without approved artifacts
- **Effort estimation**: SP-driven `/effort` workflow with 5 role multipliers, 1.25× overhead factor, LOC/LOS validation

### GForge.ai: Personal Epistemic Engine
- **Architecture**: Fastify + React + Prisma + PostgreSQL, full observability stack
- **Workflow system**: Same 12 workflows, same governance rules — shared across both projects
- **Key innovation**: Pulse productivity dashboard with PulseSnapshot model: per-category activity aggregates (letters, research, courses, fieldnotes, codebase) with published/draft visibility, weekly codebase metric buckets, and automated scheduler ingestion
- **Productivity model**: Productivity = Definitional Work (Lines of Spec + Tasks) + Execution Throughput (Lines of Code)
- **Codebase comprehension pipeline**: PulseStore (902 lines), scheduler worker, metric ingestion, fixture pack system — all being replaced by gwrk

### What's Being Extracted

| Category | Files | Lines | Ships With gwrk |
|---|---|---|---|
| Workflow Definitions | 12 | ~2,333 | ✅ Core |
| Governance Rules | 7 | ~533 | ✅ Core |
| Agent Personas | 4 | ~232 | ✅ Core |
| Agent Templates | 3 | ~328 | ✅ Core |
| Specify Templates | 10 | ~591 | ✅ Core |
| Specify Scripts | 5 | ~1,492 | ✅ Core |
| Dev Infrastructure | 9 | ~1,717 | ✅ Runtime |
| Effort Estimation | 1 | ~174 | ✅ Engine |
| Pulse Model (generalized) | — | — | ✅ Dashboard |
| **Total** | **51+** | **~7,400** | |

---

# 5. Architecture Vision

## The OpenClaw-Inspired Model

gwrk borrows three proven patterns from OpenClaw:

### Pattern 1: The Local Gateway (Agent-ZFG)

Like OpenClaw's Gateway (`ws://127.0.0.1:18789`), Agent-ZFG is a persistent local daemon serving as the **control plane**:

```
┌── gwrk gateway (local daemon) ──────────────────────────┐
│   Listens on: localhost:18790                             │
│                                                           │
│   ├── Spec Pipeline Engine                                │
│   │     /specify → /plan → /plan-to-tasks                 │
│   ├── Dispatch Queue                                       │
│   │     Phase assignments → Agent pool                    │
│   ├── Git Tree Manager                                     │
│   │     Branch creation, merge, conflict resolution       │
│   ├── PR Monitor (GitHub Actions polling)                 │
│   │     gh pr list, gh run watch                          │
│   ├── Review Gate                                          │
│   │     /review-code → /review-uat → GO/NO-GO            │
│   ├── Slack Channel (@slack/bolt)                         │
│   │     Status updates, approval requests, commands       │
│   ├── Pulse Engine                                         │
│   │     Git log analysis, snapshot generation             │
│   └── Effort Estimator                                     │
│         SP extraction, role bracketing, hour derivation   │
└───────────────────────────────────────────────────────────┘
          │              │               │
          ▼              ▼               ▼
    ┌── Phone ──┐  ┌── Local ──┐  ┌── Cloud Agent(s) ──┐
    │ Slack     │  │ Agent-ZFG │  │ Agent-WUD instances │
    │ channels  │  │ owns orch │  │ (ephemeral sandboxes)│
    └──────────┘  └───────────┘  └─────────────────────┘
```

### Pattern 2: Docker Sandboxes (Agent-WUD)

Like OpenClaw's sandbox model (`agents.defaults.sandbox`), each WUD instance runs in an isolated Docker container:

| OpenClaw Concept | gwrk Equivalent |
|---|---|
| `sandbox.mode: "non-main"` | WUD instances always sandboxed; ZFG runs on host |
| `sandbox.scope: "session"` | One container per phase |
| `sandbox.workspaceAccess: "rw"` | Phase branch mounted read-write at `/workspace` |
| `sandbox.docker.binds` | Repository mounted, plus agent context payload |
| `sandbox.docker.network` | Network access for `gh` CLI operations |

### Pattern 3: Slack Channel

Like OpenClaw's messaging integration, gwrk's build server communicates via Slack (Socket Mode — outbound WebSocket, no public URL):

| Capability | gwrk Implementation |
|---|---|
| Channel-per-project | `gwrk new` / `gwrk init` creates `#<project-name>` |
| Slash commands | `/gwrk status`, `/gwrk approve`, `/gwrk dispatch`, `/dream` |
| Interactive buttons | Review verdict buttons (GO / NO-GO / NEEDS REWORK) |
| Threaded DUT | Ideation conversations happen in threads |
| Reactions | ✅ react-to-approve for lightweight confirmation |
| Presence | Notification throttling (active=verbose, away=batched) |

### Git Branching Model

```
develop
  └── feature/<feature-name>-wip          (owned by ZFG)
        ├── phase/<feature-name>-phase-01  (owned by WUD #1)
        ├── phase/<feature-name>-phase-02  (owned by WUD #2)
        └── phase/<feature-name>-phase-03  (owned by WUD #3)
```

### Pattern 4: App Home Tab + Tunnel (Remote Observability)

gwrk extends the OpenClaw model with a **Slack App Home Tab** — a real-time dashboard rendered natively in Slack via Block Kit. Combined with a tunnel layer (Cloudflare Tunnel / Tailscale Funnel), the build server is accessible remotely:

| Capability | Implementation |
|---|---|
| **Ops View** | Active agents, dispatch queue, system resources |
| **Pulse View** | LOC trends, spec progress, repo snapshots |
| **Compression View** | Point/Total ratios, feature timelines |
| **Project View** | Phase progress, gate status, agent assignments |
| **Remote Access** | `gwrk tunnel start` → Cloudflare Tunnel |
| **Auth** | Slack-native (already authenticated) |
| **Mobile-First** | Slack app on phone, Block Kit rendering |

The two interaction modes complement each other:

| Mode | Best For |
|---|---|
| **Slack Commands + Reactions** | Actions: approvals, dispatch, DUT ideation (push + pull) |
| **App Home Tab** | Watching, monitoring, understanding (pull) |

---

# 6. The Principal Engineer Thesis

gwrk is designed around a specific conviction: **the limiting factor in AI-assisted software development is architectural judgment, not code generation.**

### The Skill That Matters

The person driving gwrk should think as a **Principal Engineer** and operate as an **Architect**. This means:

| Skill | Why It Matters for gwrk |
|---|---|
| **System decomposition** | Better spec → better plan → better phase isolation → fewer merge conflicts |
| **Interface design** | Clean contracts between phases mean agents don't stomp on each other |
| **Dependency ordering** | Correct phase sequencing means parallelization actually works |
| **Review rigor** | Knowing what "good" looks like means review gates catch real problems |
| **Risk identification** | Flagging the hard parts early keeps agents on the happy path |
| **Pattern recognition** | Recognizing when agent output is structurally wrong, not just syntactically |

### What gwrk Replaces

gwrk replaces the **cumbersome codebase comprehension pipeline** used in GForge.ai. Instead of:
- Writing prompts to make agents understand the codebase
- Manually assembling monorepo-context templates
- Re-explaining architecture decisions to every new agent session
- Pasting specs and plans into chat windows

gwrk provides:
- **Context compilation**: `.agents/` directory automatically bundled into agent context
- **Persistent governance**: Rules and personas carried across every session
- **Spec-first pipeline**: Architecture decisions codified in `spec.md` and `plan.md`, not lost in chat
- **Continuous memory**: Build server maintains state across agent sessions

### The Feedback Loop

The better your specs, the better your agents perform. gwrk makes this feedback loop tight:

```
Your architecture skill → Better specs → Better plans → Better phases
    → Fewer conflicts → Higher first-pass review rate → More shipped code
    → Better understanding → Even better specs (next feature)
```

---

# 7. Slack: The Comms Layer

## Why Slack Changes Everything

The single biggest bottleneck in AI-automated development is **decision latency**. When a pipeline stalls — failed CI, review rejection, merge conflict — it stays stalled until a human sits at a terminal. Slack eliminates this bottleneck entirely — and unlike single-threaded messaging apps, Slack supports **multiple projects concurrently** through its channel-per-project model.

## How It Works

gwrk's build server runs a Slack app via **Socket Mode** (`@slack/bolt`) — an outbound WebSocket connection that requires no public URL and runs behind your firewall. Zero phone-home. Channel-per-project model: `#gwrk`, `#code-red`, `#gforge-ai`.

### Status Updates (gwrk → You)

Posted to the project's channel with Block Kit formatting:

```
🏗️ [code-red] Phase 02: Engine Foundation
   Agent WUD-2 started implementation
   Branch: phase/002-engine-foundation-phase-02
   Tasks: 5 remaining

✅ [code-red] Phase 01: Monorepo Scaffold
   All tests passing. PR #14 ready for review.
   [Review Now] [Approve] [See Diff]

🔴 [gforge-ai] Phase 03: LLM Integration
   CI failed: 2 test failures in synthesis.test.ts
   [View Logs] [Retry] [Assign to Me]

⚡ Pulse Update (daily)
   code-red:  +482 LOC (main), +1,204 LOC (drafts)
   gforge-ai: +310 LOC (main), +890 LOC (drafts)
   gwrk:      +620 LOC (main)
```

### Slash Commands (You → gwrk)

| Command | Action |
|---|---|
| `/gwrk status` | Current state of all active features across all repos |
| `/gwrk status <feature>` | Detailed phase-by-phase breakdown |
| `/gwrk approve <feature> <phase>` | Accept review verdict and merge PR |
| `/gwrk reject <feature> <phase> <reason>` | Reject with feedback, re-dispatch agent |
| `/gwrk dispatch <feature>` | Start/resume feature implementation |
| `/gwrk pause <feature>` | Halt all active agents for a feature |
| `/gwrk pulse` | Productivity snapshot across all repos |
| `/gwrk pulse <repo>` | Detailed repo metrics with trends |
| `/gwrk effort <feature>` | Run effort estimation for a feature |
| `/gwrk logs <feature> <phase>` | Get recent agent output logs |
| `/dream <description>` | Start DUT ideation thread |

### Interactive Buttons for Reviews

When a phase completes and a review is ready, gwrk posts a message with interactive buttons:

```
📋 Review: code-red / 002-engine-foundation / Phase 01

PE Verdict: GO ✅
  "Clean implementation. Follows governance rules.
   Tree-sitter integration correct. Test coverage 94%."

UAT Verdict: GO ✅
  "Parser produces expected output for all fixtures."

[✅ Merge] [🔄 Request Changes] [🔍 View Full Review]
```

Tap **Merge** from your phone. The pipeline continues. Or just react with ✅ for lightweight approval.

### Threaded DUT Conversations

DUT ideation happens in **threads** within the project channel. Multiple ideation conversations, multiple projects, all concurrent, all searchable.

### Presence-Aware Notifications

gwrk observes your Slack presence: Active → verbose updates. Away → batched summaries. Don't wake up to 47 phase updates at 2am.

### Future Channels

Slack is the MVP channel. The architecture supports additional channels:

| Channel | Priority | Status |
|---|---|---|
| **Slack** | MVP | `@slack/bolt` Socket Mode |
| Telegram | P2 | grammY (future, for non-Slack users) |
| Discord | P3 | Discord.js bot |

---

# 8. The Multi-Agent Dispatch Engine

## The Principle: Done, Done!

Borrowed from OpenClaw's ethos: **maniacal commitment to completion**. gwrk doesn't dispatch a task and hope. It dispatches, monitors, evaluates, and — if the agent fails — retries with a different backend. The pipeline doesn't stop until the work is done or all options are exhausted and a human is escalated via Slack.

## The Execution Topology: Cloud vs. Local

Not all agents are created equal. The critical architectural fact:

| Agent | Execution Environment | Parallelism Model |
|---|---|---|
| **Codex CLI** | **Cloud** (ephemeral microVM via Codex Cloud) | True parallelism — each task gets its own cloud VM, its own clone, its own sandbox. No local resources consumed. |
| **Claude Code** | **Local** (runs in CWD on your machine) | Shares your filesystem. Multiple instances need separate repo clones. |
| **Gemini CLI** | **Local** (runs in CWD on your machine) | Shares your filesystem. Multiple instances need separate repo clones. Antigravity can task multiple sub-agents. |

This distinction shapes everything about how gwrk dispatches work.

### Codex Cloud: The Only True Cloud Agent

Codex Cloud provides isolated, ephemeral microVMs for autonomous coding. Each task spins up its own environment, clones the repo, installs dependencies, writes code, runs tests, opens a PR — and the VM is destroyed. This means:

- **Unlimited parallelism** (bounded by your Codex plan, not your hardware)
- **No local resource consumption** — your laptop stays cool
- **Ephemeral by design** — if the agent doesn't push, the work is lost
- **Pre-authenticated `gh`** — PRs opened automatically
- **`AGENTS.md` directives** — Codex reads `AGENTS.md` at repo root for project rules
- **GitHub integration** — `@codex` in PR comments triggers cloud tasks or reviews directly from GitHub

Codex Cloud **requires manual per-project setup** via the Codex Web UI:
1. Connect the GitHub repository
2. Select the base environment (Node/Ubuntu)
3. Define setup commands (e.g., `pnpm install --frozen-lockfile && pnpm turbo run build`)
4. Add environment variables (secrets, API keys)
5. Create `AGENTS.md` with project rules

**gwrk walks you through this**: `gwrk codex setup` checks for an existing Codex configuration and guides you through linking, environment setup, and `AGENTS.md` generation from your `.agents/rules/` directory.

See [`docs/reference/codex-lab.md`](file:///Users/gonzo/Code/gwrk/docs/reference/codex-lab.md) for the full Codex Cloud reference and orchestration blueprint.

### Local Agents: The Parallelism Problem

Claude Code and Gemini CLI run locally. They can be spun up as multiple instances, but **they all share your filesystem**. Two agents editing the same `src/parser.ts` simultaneously = disaster.

gwrk solves this with **managed repo clones**:

```
~/.gwrk/workspaces/
  ├── code-red/
  │   ├── clone-01/    ← Claude instance (Phase 01)
  │   ├── clone-02/    ← Gemini instance (Phase 02)
  │   └── clone-03/    ← Claude instance (Phase 03)
  └── gforge-ai/
      └── clone-01/    ← Gemini instance (Phase 01)
```

Each clone is:
- A full `git clone` of the repo (shallow where possible for speed)
- Checked out to its own phase branch
- Isolated — agents can't stomp on each other
- Cleaned up after merge

**gwrk will only clone when asked to.** By default, local agents run on the original repo one at a time. To enable local parallelism:

```bash
gwrk config set parallelism.local.clones 3   # Max 3 simultaneous local clones
gwrk config set parallelism.local.maxCpu 80   # Don't exceed 80% CPU
gwrk config set parallelism.local.maxMem 70   # Don't exceed 70% memory
```

### System Monitoring: Never Run Hotter Than You Want

gwrk monitors system resources and **throttles local agent dispatch** to keep your machine responsive:

| Monitor | Default Limit | Action When Exceeded |
|---|---|---|
| CPU usage | 80% | Pause queued local dispatches, let running agents finish |
| Memory usage | 70% | Pause queued dispatches, warn via Slack |
| Disk free | 10 GB minimum | Refuse to create new clones, alert user |
| Agent count | 3 concurrent local | Queue excess phases until a slot opens |

Codex Cloud dispatches are **exempt from local limits** — they run on OpenAI's infrastructure.

The motivation: **maximize throughput of the local gwrk server without melting your laptop.** If you want it hotter, raise the limits. If you want it cooler, lower them. gwrk respects your boundaries.

## Three Agent Backends, One Dispatch Interface

gwrk ships with first-class support for all three major agent CLIs:

### Codex CLI — Local + Cloud

| Capability | Local Invocation | Cloud Invocation |
|---|---|---|
| **Execution** | `codex exec "<prompt>"` | Codex Cloud microVM (via Web UI, `@codex` in GitHub, or API) |
| **Auto mode** | `--full-auto` (sandboxed) | Cloud tasks are always fully autonomous |
| **Sandbox** | `--sandbox workspace-write` | Cloud VM is the sandbox |
| **Working directory** | `--cd <workspace>` | Set in Codex Cloud project config |
| **Output capture** | `--output-last-message <file>` / `--json` | PR is the output artifact |
| **Code review** | `codex review --base <branch>` | `@codex review` in GitHub PR comment |
| **Resume** | `codex exec resume --last` | N/A (ephemeral) |

**gwrk local invocation:**
```bash
codex exec --full-auto --cd ~/.gwrk/workspaces/code-red/clone-01 \
  --output-last-message /tmp/result.md \
  "$(cat .gwrk/phase-context.md)"
```

**gwrk cloud invocation (via GitHub):**
```
@codex implement phase 01 per .gwrk/phase-context.md
```

### Claude Code — Local Only

| Capability | Invocation |
|---|---|
| **Headless mode** | `claude -p "<prompt>"` |
| **Max iterations** | `--max-turns <n>` |
| **Output format** | `--output-format json` or `stream-json` |
| **Working directory** | Runs in CWD (gwrk sets via managed clone) |
| **Agent SDK** | Programmatic TypeScript/Python access for custom orchestration |
| **MCP support** | Full MCP protocol for external tool integration |
| **Persistent memory** | `CLAUDE.md` system for cross-session rules |

**gwrk invocation (in managed clone):**
```bash
cd ~/.gwrk/workspaces/code-red/clone-02 && \
claude -p --max-turns 50 --output-format json \
  "$(cat .gwrk/phase-context.md)"
```

### Gemini CLI — Local Only

| Capability | Invocation |
|---|---|
| **Headless mode** | `gemini -p "<prompt>"` or stdin piping |
| **Output format** | JSON structured output |
| **Model routing** | Auto-routing (Gemini 3 Pro / Flash) or `--model` |
| **Context system** | Hierarchical `GEMINI.md` files |
| **MCP support** | Full MCP protocol for tool extensibility |
| **Sub-agents** | Antigravity can task multiple background agents |
| **Shell execution** | Runs `git`, `npm test`, etc. within the agent loop |

**gwrk invocation (in managed clone):**
```bash
cd ~/.gwrk/workspaces/code-red/clone-03 && \
cat .gwrk/phase-context.md | gemini -p --json
```

## The Agent Router

gwrk routes tasks to the backend most likely to succeed, with awareness of the cloud/local split:

| Task Type | Preferred Backend | Rationale |
|---|---|---|
| **Autonomous implementation** | Codex Cloud | True parallelism, no local resources, purpose-built for autonomous execution |
| **Code review** | Codex (GitHub `@codex review`) | First-class, triggers directly from PR |
| **Long-context refactoring** | Claude Code (local clone) | Deepest context window, best at coherent large-scale changes |
| **Multi-file generation** | Gemini CLI (local clone) | Strong parallel tool use, auto-routing across model tiers |
| **Test generation** | Claude Code or Codex | Both strong; Claude for complex logic, Codex for coverage |
| **Definition work** (spec, plan) | Gemini CLI | Strongest at structured document generation |
| **Heavy parallel dispatch** | Codex Cloud | Offload to cloud when local resources are saturated |

The router is configurable in `.gwrkrc.json`:

```json
{
  "agents": {
    "defaults": {
      "implement": "codex-cloud",
      "review": "codex-github",
      "define": "gemini",
      "refactor": "claude"
    },
    "fallbackOrder": ["codex-cloud", "codex-local", "claude", "gemini"],
    "backends": {
      "codex-cloud": {
        "type": "cloud",
        "trigger": "github-mention",
        "requires": "codex-setup"
      },
      "codex-local": {
        "type": "local",
        "command": "codex exec",
        "flags": ["--full-auto", "--sandbox", "workspace-write"]
      },
      "claude": {
        "type": "local",
        "command": "claude",
        "flags": ["-p", "--max-turns", "50", "--output-format", "json"]
      },
      "gemini": {
        "type": "local",
        "command": "gemini",
        "flags": ["-p", "--json"]
      }
    },
    "parallelism": {
      "local": { "maxClones": 3, "maxCpu": 80, "maxMem": 70 },
      "cloud": { "maxConcurrent": 10 }
    }
  }
}
```

## Done, Done! — The Completion Protocol

Every WUD dispatch follows the **Done, Done! protocol** — the task isn't marked complete until gwrk verifies completion, not just agent termination:

1. **Hard-Gate Discipline**: Not just a checklist, but a set of generated shell scripts (`gates/*.sh`) that physically prevent the agent from advancing state until requirements are met. No interpretation, only execution.
2. **Done, Done! Verification**: State transitions (`open` → `in_progress` → `completed`) are governed by the CLI and verified by gates, with mandatory PR creation and CI passing.
3. **Maniacal Commitment Loop**:
   - `DISPATCH`   → Agent receives phase context + governance rules
   - `PRE-FLIGHT` → `gates/T0xx-gate.sh` must FAIL (verify RED)
   - `EXECUTE`    → Agent implements code + tests
   - `POST-FLIGHT`→ `gates/T0xx-gate.sh` must PASS (verify GREEN)
   - `DONE`       → `gwrk tasks done` updates state + commits
                 (cloud: Codex Cloud microVM; local: managed clone)
2. MONITOR     → gwrk watches for agent output (JSONL / stdout / PR)
3. EVALUATE    → Agent exits. gwrk checks:
                  □ Did all specified files get created/modified?
                  □ Do tests pass? (npm test / make test)
                  □ Does the code lint? (biome / eslint)
                  □ Does the build succeed? (tsc --noEmit)
4. DONE?       → If all checks pass: PR created → Review gate
5. NOT DONE?   → If checks fail:
                  a. Retry same agent with error context (up to 3 retries)
                  b. Escalate to next backend in fallbackOrder
                  c. If all backends exhausted: Slack alert to human
6. DONE, DONE! → PR merged, compression recorded, clone cleaned up, Slack 🏆
```

### Retry with Escalation

```
Attempt 1: codex-cloud (Phase 01)
  → Cloud VM boots, implements, tests fail (3 failures in parser.test.ts)
  → Retry: codex-cloud with error context
  → Still failing

Attempt 2: claude (local clone-01, Phase 01)
  → cd ~/.gwrk/workspaces/code-red/clone-01
  → claude -p --max-turns 50 "implement phase 01 [+ previous failures]"
  → All tests pass
  → PR created ✅

Result: Done, Done! (backend: claude, attempt: 2, clone cleaned up)
```

## Tandem Dispatch

For features with parallelizable phases, gwrk dispatches **different backends simultaneously** — mixing cloud and local:

```
feature/003-ast-diff
  ├── Phase 01 (scaffolding)    → Codex Cloud    [☁️ running in microVM]
  ├── Phase 02 (core algorithm) → Claude Code    [💻 local clone-01]
  └── Phase 03 (test suite)     → Gemini CLI     [💻 local clone-02]
```

Three agents. Three vendors. Two local clones + one cloud VM. One git tree. One merge strategy. Your laptop only runs two agents — the heavy scaffolding work is offloaded to the cloud.

---

# 9. Agent-DUT: Dream Until Told

## The Missing Phase: Before the Spec

The gwrk pipeline starts at `spec.md`. But where does the spec come from?

Today: you sit at your laptop, open a text editor, and write it. The best ideas come at the worst times — walking the dog, cooking dinner, 2am when you can't sleep. By the time you're back at your desk, the spark is dimmer.

**Agent-DUT makes Slack your spec factory.** You message it like a collaborator. It thinks like a Principal Engineer.

## How DUT Works

Agent-DUT is a **conversational loop** that runs in Slack threads:

```
You:   "I want to add historical git analysis to gwrk. Like, you
        point it at any repo and it gives you weekly LOC trends."

DUT:   🧠 Interesting. A few questions:
        1. Should it analyze all branches or just the default?
        2. Weekly buckets — do you want LOC added/deleted/net?
        3. Should it separate "main" LOC from "draft" branches?
        4. What about repos with 50K+ commits — performance target?

You:   "All branches, separate main vs drafts, both added and
        deleted, and it should be fast — under 60 seconds for
        a big repo."

DUT:   ✅ Got it. Here's what I'm forming:

        Feature: Pulse Historical Scan
        ─────────────────────────
        • Input: any git repo path
        • Walk git log, bucket by week
        • Separate main vs feature/draft branches
        • Output: PulseSnapshot JSON + CLI table
        • Perf: <60s for 50K commits

        Architecture risk: branch detection heuristics.
        Should I use git's default branch detection or
        require explicit config?

You:   "Use git's default. And make it a subcommand:
        gwrk pulse scan [path]"

DUT:   📋 Draft spec forming. Two more questions:
        1. Should the scan output be cached for re-display?
        2. What format for the weekly table — terminal-only
           or also JSON for the dashboard?

You:   "Both. Cache the JSON, render the table from it."

DUT:   ✅ Spec ready for review.
        [View Draft Spec] [Edit] [Ship It 🚀]
```

Tap **Ship It**. DUT writes `specs/pulse-scan/spec.md`, commits it to the repo, and notifies Agent-ZFG. ZFG picks it up, runs `/plan`, and the pipeline starts building.

**You dreamed it on a walk. gwrk builds it while you have dinner.**

## The DUT Loop

```
1. SPARK       → You message DUT with a raw idea (text, voice note, screenshot)
2. CLARIFY     → DUT asks targeted questions (architecture, scope, risks, UX)
3. SHAPE       → DUT synthesizes answers into structured feature outline
4. REFINE      → You iterate via conversation ("add this", "drop that", "what about...")
5. REVIEW      → DUT presents draft spec with inline buttons: [Edit] [Ship It]
6. SHIP        → DUT writes spec.md → commits → 🔗 handoff to DUS
7. DEFINE      → DUS runs define-until-solid (plan→tasks→analyze→tests) → 🔗 handoff to ZFG
8. BUILD       → ZFG dispatches WUD agents → implement→review→merge → Done, Done!
```

The loop runs until **you tell it to stop** — hence "Dream Until Told." No time limit. No session expiry. You can start an idea on Monday, add context on Wednesday, and ship it on Friday. DUT maintains the conversation thread.

## What DUT Knows

DUT isn't starting from zero. It has access to:

| Context Source | What DUT Uses It For |
|---|---|
| `.agents/rules/*.md` | Governance constraints (what's allowed, coding style, architecture patterns) |
| `specs/*/spec.md` | Existing feature specs (to avoid duplication and identify dependencies) |
| `specs/000-build-plan.md` | Overall project roadmap (to place the new feature in context) |
| Pulse snapshot | Current repo state (LOC, velocity, draft branches) |
| Effort model | Approximate SP/hours for the proposed feature |
| Git history | What's already been built (to ground architectural suggestions) |

This means DUT's questions are informed. It doesn't ask generic questions — it asks questions grounded in *your* project's actual state.

## DUT Capabilities

| Capability | How |
|---|---|
| **Text ideation** | Standard Slack messages — describe what you want |
| **Voice notes** | Slack audio clips or text transcription → DUT processes |
| **Image/screenshot input** | Forward a whiteboard sketch or UI mockup → DUT interprets |
| **Multi-session threads** | Return to an idea days later; DUT keeps the thread alive |
| **Effort preview** | DUT runs a quick estimate: "This looks like ~13 SP, 97h, RE+TS roles" |
| **Spec generation** | Produces `spec.md` following `.specify/templates/spec-template.md` |
| **Auto-plan option** | If you tap [Ship It + Plan], DUT also generates `plan.md` before handing off |
| **Repo-aware suggestions** | "You already have a git-log parser in pulse.ts — should this extend it?" |

## Slack Commands for DUT

| Command | Action |
|---|---|
| `/dream` | Start a new DUT ideation session |
| `/dream <repo>` | Start ideation for a specific repository |
| `/dream status` | List all active DUT threads (in-progress ideas) |
| `/dream ship <thread>` | Finalize and commit the spec from DUT thread |
| `/dream discard <thread>` | Abandon an idea thread |
| `/dream resume` | Continue the most recent DUT thread |

## The Agent Family

| Agent | Name | Role | Environment | Loop | Hands Off To |
|---|---|---|---|---|---|
| **DUT** | Dream Until Told | Ideate, clarify, spec | **Slack threads** | Conversation → Ship It | → DUS |
| **DUS** | Define Until Solid | Spec → plan → tasks → analyze | Local CLI | Quality gate loop | → ZFG |
| **ZFG** | Zero F*cks Given | Orchestrate, merge, resolve | Local daemon | Feature lifecycle | → WUD |
| **WUD** | Work Until Done | Implement, test, PR | Cloud VM or local clone | Phase → Done, Done! | → ✅ merge |

### The Full Pipeline

```
📱 Slack              💻 Local CLI           💻 Local Daemon         ☁️/💻 Cloud or Local
───────────────────   ─────────────────────   ─────────────────────   ───────────────────────
  DUT                    DUS                     ZFG                     WUD
  │                      │                       │                       │
  │ 💬 Dream idea        │                       │                       │
  │ 🧠 Clarify           │                       │                       │
  │ 📋 Shape spec        │                       │                       │
  │ 🚀 Ship It           │                       │                       │
  │──── spec.md ───────▶│                       │                       │
  │                      │ Plan → Tasks          │                       │
  │                      │ Analyze (loop)        │                       │
  │                      │ Define tests          │                       │
  │                      │ Import tasks          │                       │
  │                      │──── ✅ SOLID ──────▶│                       │
  │                      │                       │ Create branches       │
  │                      │                       │ Dispatch agents       │
  │                      │                       │──── phase ───────▶│
  │                      │                       │                       │ Implement
  │                      │                       │                       │ Test (loop)
  │                      │                       │                       │ Open PR
  │                      │                       │◀──── PR ready ────│
  │                      │                       │ Review + merge        │
  │                      │                       │ Resolve conflicts     │
  │                      │                       │ Final PR → develop    │
 📱◀── 🏆 Done, Done! ──│────────────────────│────────────────────│─────────────────────│
```

DUT is the only agent that runs *inside* Slack threads rather than alongside it. It doesn't report to Slack — it *lives* there. And when the whole chain fires — DUT → DUS → ZFG → WUD — you go from a message on a walk to a merged PR without ever opening a laptop.

---

# 10. Jobs To Be Done

### The Architect Who Dreams on the Move
> When I have an idea for a new feature — on a walk, in a café, at 2am — I want to **type `/dream` in Slack and have a real conversation** that shapes the idea into a structured spec, so that by the time I'm back at my desk, the spec is written and the pipeline is already running.

### The Architect Who Builds Alone at Scale
> When I'm the sole developer on multiple simultaneous projects and I have strong architectural opinions, I want to **turn my specs into shipped features without sitting at a terminal for every step** — dispatching agents, monitoring results, and approving merges from my phone via Slack so I can stay productive even when I'm not at my desk.

### The Principal Engineer Who Wants Visibility
> When I'm shipping code across multiple repos, I want a **single productivity dashboard that shows me what's published, what's in progress, and what's defined** — not server metrics, but a real picture of my body of work. And I want it generated from existing Git history, not requiring a special setup.

### The Technical Lead Who Needs Estimates
> When a stakeholder asks "how long will this take?", I want gwrk to **extract stories from my specs, bracket them by role, compute SP-derived hours, and generate a professional effort report** — not a guess, but a structured estimate I can hand to a client.

### The Solo Dev Who Wants Governance Without Bureaucracy
> When using AI agents for implementation, I want **spec-first governance that runs automatically** — catching bad decomposition, enforcing review gates, blocking merges until CI is green — without me building any of that infrastructure.

### The Experienced Engineer Joining a New Project
> When I join an existing repository, I want to `gwrk pulse scan` it and **immediately see a comprehensive productivity history** — weekly LOC trends, branch activity, repository size evolution — so I understand the project's velocity and cadence before writing a line of code.

---

# 11. User Personas & Stories

| ID | As a… | I want to… | So that… | SP |
|---|---|---|---|---:|
| **US-01** | Architect | Run `gwrk feature <name>` and have the entire spec→plan→implement→review→merge lifecycle execute autonomously | I ship features while I sleep | 13 |
| **US-02** | Architect | Receive Slack notifications for review verdicts, CI results, and merge conflicts | I can unblock the pipeline from my phone | 8 |
| **US-03** | Architect | Approve or reject reviews via Slack interactive buttons or ✅ reactions | I never need to open a laptop to keep the pipeline moving | 5 |
| **US-04** | Architect | Type `/dream` in Slack and have a threaded conversation that produces a spec.md | I turn ideas into specced features from my phone | 8 |
| **US-04** | Architect | Have multiple agents work on different phases simultaneously | Feature delivery is parallelized, not serialized | 8 |
| **US-05** | Architect | Have merge conflicts automatically resolved using AI | I don't manually untangle git conflicts from agent output | 8 |
| **US-06** | PE | See a Pulse dashboard showing published/draft LOC, weekly trends, and spec progress across all repos | I know the state of my work at a glance | 5 |
| **US-07** | PE | Run `gwrk pulse scan` on any existing git repo and get a historical productivity snapshot | I understand a project's velocity without any gwrk-specific setup | 5 |
| **US-08** | PE | Run `gwrk effort <feature>` and get a role-bracketed, SP-derived effort report | I can give clients a structured estimate in minutes | 5 |
| **US-09** | PE | Enforce spec-first governance across all projects using agents | No agent ships code without an approved specification | 5 |
| **US-10** | PE | Review code produced by agents through a structured review workflow | Quality gates are explicit and auditable | 5 |
| **US-11** | PE | See Point Compression and Total Compression ratios for every shipped feature | I know exactly how much faster agents + architecture made me | 5 |
| **US-12** | Platform Eng | Install gwrk via `npm install -g gwrk` and scaffold the `.agents/` directory | Setup takes 5 minutes, not 5 hours | 3 |
| **US-13** | Platform Eng | Run `gwrk server start` and have a local build server with Docker sandboxes | Cloud agents have a secure local execution target | 8 |
| **US-14** | Builder | Run `gwrk define <feature>` for the definition-until-solid loop | All definition work is complete before implementation starts | 8 |
| **US-15** | Builder | Request `/gwrk pulse` via Slack and get a summary including compression ratios | I track velocity and compression without context-switching | 3 |

**Total estimated story points: 120 SP**

---

# 12. Core Components

## 10.1 The CLI (`gwrk`)

```bash
# === Lifecycle Commands ===
gwrk init                          # Scaffold .agents/, .specify/, specs/ in current project
gwrk server start                  # Start the local build server (Gateway daemon)
gwrk server stop                   # Stop the daemon

# === Definition Pipeline ===
gwrk specify <feature>             # /specify — create spec.md from description
gwrk plan <feature>                # /plan — create plan.md from spec
gwrk tasks <feature>               # /plan-to-tasks — decompose into importable tasks
gwrk define <feature>              # /define-until-solid — run the full definition loop
gwrk analyze <feature>             # /analyze — cross-artifact consistency audit

# === Execution Pipeline ===
gwrk implement <feature> <phase>   # /implement — execute a single phase
gwrk wud <feature>                 # /work-until-done — autonomous implement→review→PR→CI loop
gwrk feature <feature>             # Full end-to-end: define → implement all phases → merge

# === Review ===
gwrk review-code <feature> <phase> # /review-code — technical review (PE persona)
gwrk review-uat <feature> <phase>  # /review-uat — acceptance testing (PM persona)

# === Productivity ===
gwrk pulse                         # Show current Pulse snapshot across all tracked repos
gwrk pulse scan [path]             # Scan any existing git repo, generate historical Pulse
gwrk pulse dashboard               # Open Pulse web view in browser
gwrk effort <feature>              # Generate effort estimate from spec stories
gwrk compression <feature>         # Show compression ratios for a shipped feature
gwrk compression --all             # Summary compression across all features

# === Slack ===
gwrk setup slack                   # Automated Slack app provisioning (Socket Mode)

# === Codex Cloud ===
gwrk codex setup                   # Walk through Codex Cloud project setup
gwrk codex status                  # Check Codex Cloud connection + environment
gwrk codex agents-md               # Generate AGENTS.md from .agents/rules/

# === Dashboard & Remote Access ===
# Open gwrk App Home Tab in Slack for real-time dashboard
gwrk tunnel start                  # Start tunnel (cloudflared/tailscale)
gwrk tunnel start --provider cloudflared  # Explicit provider selection
gwrk tunnel status                 # Show tunnel URL
gwrk tunnel stop                   # Tear down tunnel

# === Parallelism & System ===
gwrk config set parallelism.local.clones 3    # Max simultaneous local repo clones
gwrk config set parallelism.local.maxCpu 80   # CPU throttle (%, default 80)
gwrk config set parallelism.local.maxMem 70   # Memory throttle (%, default 70)
gwrk status                        # Active agents, clones, system resources
```

## 10.2 Workflow Definitions (`.agents/workflows/`)

| Workflow | Persona | Purpose |
|---|---|---|
| `specify.md` | Product Manager | Create spec.md from natural language |
| `plan.md` | Senior Architect | Create plan.md from spec |
| `plan-to-tasks.md` | Senior Architect + Auditor | Decompose into importable tasks |
| `define-tests.md` | QA Architect | Generate RED test files before implementation |
| `implement.md` | Senior Developer | Execute all tasks in a phase |
| `review-code.md` | Principal Engineer | Technical code review |
| `review-uat.md` | Product Manager | User acceptance testing |
| `analyze.md` | Principal Engineer | Cross-artifact consistency analysis |
| `effort.md` | Principal Engineer | SP-driven effort estimation |

## 10.3 Governance Rules (`.agents/rules/`)

| Rule | Purpose |
|---|---|
| `operating-model.md` | Foxtrot Charlie principles, RAGB definitions |
| `workspace.md` | File conventions, config hygiene |
| `coding-style.md` | Language-specific coding standards |
| `api-architecture.md` | Hexagonal registry, API design |
| `seeding-governance.md` | Fixture and seed data management |
| `observability-governance.md` | Metric naming, dashboard standards |
| `route-reference.md` | Route contract validation |

---

# 13. The gwrk Build Server (OpenClaw-Inspired)

## Architecture

The build server is a local daemon modeled after OpenClaw's Gateway:

```
┌──────────────────────────────────────────────────────────────┐
│                      gwrk build server                        │
│                    (localhost:18790)                           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Dispatch      │  │ Git Manager  │  │ Slack Channel      │  │
│  │ Queue         │  │              │  │                    │  │
│  │ - Phase pool  │  │ - Branch ops │  │ - Slack Channel    │  │
│  │ - Agent pool  │  │ - Merge      │  │ - @slack/bolt      │  │
│  │ - Retry logic │  │ - Conflict   │  │ - Command handling │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘  │
│         │                 │                     │              │
│  ┌──────▼─────────────────▼─────────────────────▼──────────┐  │
│  │              Docker Sandbox Manager                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │  │
│  │  │ Phase 01 │  │ Phase 02 │  │ Phase 03 │  ...          │  │
│  │  │ sandbox  │  │ sandbox  │  │ sandbox  │              │  │
│  │  │ (WUD #1) │  │ (WUD #2) │  │ (WUD #3) │              │  │
│  │  └──────────┘  └──────────┘  └──────────┘              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────┐  ┌────────────────────────────────┐  │
│  │ Pulse Engine        │  │ Review & CI Engine              │  │
│  │ - Git log scanner   │  │ /review-code → /review-uat      │  │
│  │ - Snapshot generator│  │ → verdict → Slack → merge        │  │
│  │ - Historical trends │  └────────────────────────────────┘  │
│  └─────────────────────┘                                      │
└──────────────────────────────────────────────────────────────┘
```

## Sandbox Lifecycle

1. **Creation**: Docker container per phase using `gwrk-sandbox:bookworm-slim`
2. **Workspace Mount**: Phase branch mounted at `/workspace` with read-write access
3. **Context Injection**: Persona + rules + tasks compiled into context payload
4. **Execution**: Agent runs the `work-until-done.sh` loop inside the sandbox
5. **Delivery**: On success, agent opens a PR via `gh pr create`
6. **Report**: Telegram notification sent with review summary and action buttons
7. **Termination**: Container destroyed after PR is opened

---

# 14. Pulse: The Productivity Dashboard

## What Pulse Actually Is

Pulse is NOT observability. It is not server monitoring. It is not Prometheus metrics about CPU and memory.

**Pulse is a productivity portrait.** It answers one question: *What is the state of my work?*

## The PulseSnapshot Model

Derived from GForge.ai's production Pulse implementation (`PulseStore`, `PulseSnapshot`, `EpistemicActivity`), generalized for any repository:

### Activities (per category)

| Field | Type | Description |
|---|---|---|
| `category` | string | Repository name or epistemic category |
| `visibility` | `published` / `draft_included` | Main branch = published; feature/dev branches = draft |
| `lastUpdatedAt` | ISO timestamp | Most recent activity |
| `wordCount` | number | Total LOC (for code) or word count (for content) |
| `sampleEntry` | object | Latest snapshot with totals and bucket data |

### Codebase Buckets (weekly time series)

| Field | Type | Description |
|---|---|---|
| `weekStart` | ISO timestamp | Start of the weekly bucket |
| `totalMain` | number | Cumulative LOC on the default (main/master) branch |
| `totalDrafts` | number | Cumulative LOC on draft/feature branches |
| `added` | number | Lines added during this week |
| `deleted` | number | Lines deleted during this week |

### Example Pulse Output

```
═══════════════════════════════════════════════════
 PULSE · 2026-04-01 · 3 repositories tracked
═══════════════════════════════════════════════════

 code-red          41,895 LOC (main)  1,320 LOC (drafts)
   Week of Mar 24:  +480 added  -105 deleted
   Week of Mar 17:  +450 added  -110 deleted
   Week of Mar 10:  +410 added   -90 deleted
   Trend: ▲ 17% velocity increase over 4 weeks

 gforge-ai         40,500 LOC (main)  1,320 LOC (drafts)
   Week of Mar 24:  +310 added   -50 deleted
   Week of Mar 17:  +280 added   -40 deleted
   Trend: ▲ Steady

 gwrk               3,200 LOC (main)    820 LOC (drafts)
   Week of Mar 24:  +620 added   -30 deleted
   Trend: 🆕 New repository (3 weeks tracked)

 SPECS              12 specs defined · 8 with approved plans
 EFFORT             102 SP estimated · 64 SP shipped

═══════════════════════════════════════════════════
```

## Historical Scan (`gwrk pulse scan`)

Point gwrk at any existing Git repository. It walks the commit log and generates historical trends:

```bash
gwrk pulse scan /Users/gonzo/Code/code-red
# → Generates weekly LOC buckets from first commit to HEAD
# → Separates main branch (published) from feature branches (drafts)
# → Identifies default branch automatically
# → Outputs PulseSnapshot JSON compatible with the dashboard
```

This replaces GForge.ai's 902-line `PulseStore`, its scheduler worker, and its Prisma-backed `CodebaseMetricSnapshot` table — all with a single Git log scan.

## App Home Tab (Real-Time Dashboard)

While Pulse answers "what have I built?", the **App Home Tab** answers "what is the daemon doing *right now*?"

The dashboard is a Slack-native view rendered via Block Kit `views.publish` in the gwrk app's App Home Tab:

| Panel | Content |
|---|---|
| **Ops View** | Active agents, dispatch queue, system resources |
| **Project Status** | Phase progress bars, gate pass/fail per project |
| **Pulse View** | LOC trends, spec progress, repo snapshots |
| **Compression View** | Point/Total ratios, per-feature timelines |
| **Quick Actions** | Buttons for dispatch, pulse, view logs |

### Auto-Refresh

The App Home Tab updates every 30 seconds while open. No SSE, no WebSocket reconnect logic — just Block Kit re-publish.

### Remote Access via Tunnel

Slack provides remote access natively — the App Home Tab is available from any device with Slack installed. For direct access to the build server API:

| Tunnel | Command | URL |
|---|---|---|
| **Cloudflare Tunnel** | `cloudflared tunnel run gwrk` | `https://gwrk.yourdomain.com` |
| **Tailscale Funnel** | `tailscale funnel 18790` | `https://macbook.tail1234.ts.net` |

The App Home Tab handles actions natively via Slack's authenticated context — no magic links, no JWTs, no separate auth flow.

---

# 15. Effort Estimation Engine

## Replacing /effort

gwrk ships with an automated effort estimation engine derived from Code-Red's `/effort` workflow. Instead of a human manually extracting stories and computing hours, gwrk does it programmatically:

### Role Multipliers

| Role | Code | Hours/SP | Description |
|---|---|---|---|
| **Rust / Engine Engineer** | `RE` | 6 | High-complexity systems work |
| **TS / Fullstack Developer** | `TS` | 4 | Standard TypeScript: React, APIs, tests |
| **Product Manager** | `PM` | 2 | Definition + validation |
| **Principal Engineer** | `PE` | 1.5 | Architecture review, oversight |
| **Data / Generator Engineer** | `DE` | 5 | Algorithmic complexity, test corpus |

### Automated Pipeline

```bash
gwrk effort <feature>

# 1. Extracts story inventory from spec.md + plan.md
# 2. Brackets each story by role (RE, TS, PM, PE, DE)
# 3. Computes: Role Hours = SP × Hours/SP rate
# 4. Applies 1.25× overhead factor
# 5. Generates `docs/assessments/effort-YYYY-MM-DD.md`
# 6. Optional: runs `cloc` for LOC/LOS validation
```

### Output

```markdown
# Effort Assessment: 002-engine-foundation
**Date**: 2026-04-01
**Total Story Points**: 39 SP
**Total Hours (with 1.25× overhead)**: 287.5h
**Estimated Person-Days**: 36 days

| Role | SP | Raw Hours | With Overhead | Days |
|---|---:|---:|---:|---:|
| Rust Engineer | 24 | 144 | 180 | 22.5 |
| TS Developer | 10 | 40 | 50 | 6.3 |
| Principal Engineer | 5 | 7.5 | 9.4 | 1.2 |
```

---

# 16. Compression: The Core Metric

## The Question gwrk Must Answer

Every tool in the AI coding space claims to make you faster. gwrk proves it — with a single, auditable number: **Compression**.

Compression compares **forecasted effort** (from story points and role multipliers) against **actual delivery evidence** (from Git timestamps, OS file dates, and build server logs). It's the ratio that tells you whether your architecture, your governance, and your agents are actually working.

## Two Dimensions of Compression

### Point Compression (Coding Speed)

> How much faster was the actual coding compared to the human-estimated coding time?

```
Point Compression = Estimated Coding Hours ÷ Actual Coding Time
```

**Estimated Coding Hours** come from the Effort Engine: SP × role-specific Hours/SP rate × 1.25× overhead.

**Actual Coding Time** comes from Git commit timestamps within the implementation window — the sum of active coding sessions, calculated by identifying commit clusters (gaps > 30 minutes = separate sessions) and summing session durations.

| Example | Estimated | Actual | Point Compression |
|---|---|---|---:|
| 39 SP feature, RE role | 287.5h | 0.75h (45 min) | **383×** |
| 8 SP feature, TS role | 40h | 2.5h | **16×** |
| 3 SP feature, PM role | 7.5h | 1h | **7.5×** |

### Total Compression (Delivery Speed)

> How much faster was the wall-clock delivery compared to the human-estimated elapsed time?

```
Total Compression = Estimated Elapsed Days ÷ Actual Elapsed Days
```

**Estimated Elapsed Days** come from the Effort Engine: total hours ÷ 8 hours/day.

**Actual Elapsed Days** are the wall-clock time from **first implementation commit** to **merge to develop/main** — not from spec creation, because dormancy is not delivery.

## The Dormancy Problem

This is the subtle part. When you create a feature spec on October 1st and then implement it on April 1st, what happened?

- **Spec creation**: October 1, 2025 (OS `createdAt` of `spec.md`, or first Git commit of the spec file)
- **Plan approval**: October 3, 2025 (last commit touching `plan.md` before implementation started)
- **Dormancy period**: October 3, 2025 → March 31, 2026 (179 days — spec existed, no implementation)
- **First implementation commit**: March 31, 2026 15:42 UTC
- **Last implementation commit**: March 31, 2026 16:27 UTC (45 minutes of active coding)
- **PR merged**: April 1, 2026 09:15 UTC (overnight review + CI)

### What gwrk reports:

```
═════════════════════════════════════════════════════════════
 COMPRESSION · 002-engine-foundation · Shipped 2026-04-01
═════════════════════════════════════════════════════════════

 FORECAST
   Story Points:       39 SP
   Roles:              RE (24), TS (10), PE (5)
   Estimated Hours:    287.5h (with 1.25× overhead)
   Estimated Days:     36 person-days

 ACTUALS
   Spec Created:       2025-10-01 (OS file date)
   Plan Approved:      2025-10-03 (last plan commit)
   Dormancy:           179 days (spec existed, no impl commits)
   First Impl Commit:  2026-03-31 15:42 UTC
   Last Impl Commit:   2026-03-31 16:27 UTC
   PR Merged:          2026-04-01 09:15 UTC
   Active Coding:      45 min (1 session)
   Delivery Window:    17.6 hours (first commit → merge)

 COMPRESSION
   ⚡ Point Compression:  383× (287.5h forecast → 0.75h actual coding)
   🚀 Total Compression:   49× (36 days forecast → 0.73 days delivery)
   💤 Dormancy Factor:    179 days (not counted in compression)
   📊 Session Count:      1 (single burst)

═════════════════════════════════════════════════════════════
```

## Timestamp Sources

Compression requires precise timestamps. gwrk collects them from multiple sources:

| Timestamp | Source | Purpose |
|---|---|---|---|
| Spec creation | OS `createdAt` on `spec.md` or first Git commit | Marks when the feature was conceived |
| Plan approval | Last commit touching `plan.md` before impl | Marks when design was finalized |
| First impl commit | Git log: first commit on phase branch | Start of delivery window |
| Last impl commit | Git log: last commit before PR | End of active coding |
| PR merged | GitHub API / `gh pr view` | End of delivery window |
| Session boundaries | Git commit timestamps, 30-min gap threshold | Active coding time calculation |
| Agent sandbox start | Build server Docker lifecycle logs | Agent-specific timing |
| Agent sandbox end | Build server Docker lifecycle logs | Agent-specific timing |

## Compression Across Features

```bash
gwrk compression --all
```

```
═══════════════════════════════════════════════════════════════════
 COMPRESSION SUMMARY · code-red · 6 features shipped
═══════════════════════════════════════════════════════════════════

 Feature                  SP   Est.Hours  Coding   Pt.Comp  Tot.Comp
 ─────────────────────────────────────────────────────────────────
 001-monorepo-scaffold     5      25.0h    0.3h      83×       12×
 002-engine-foundation    39     287.5h    0.75h    383×       49×
 003-ast-diff             21     157.5h    1.2h     131×       28×
 004-normalization        13      97.5h    0.5h     195×       35×
 005-comment-provenance    8      60.0h    0.8h      75×       18×
 006-exhibit-a            16     120.0h    1.1h     109×       22×
 ─────────────────────────────────────────────────────────────────
 TOTAL                   102     747.5h    4.65h    161× avg   27× avg

 📈 Trend: Point Compression improving (83× → 383× → stabilizing)
 💡 Best: 002-engine-foundation (383× point, 49× total)
 ⚠️  Worst: 005-comment-provenance (75× point — complex provenance logic)

═══════════════════════════════════════════════════════════════════
```

## What Compression Tells You

| Signal | Interpretation |
|---|---|
| High Point Compression, High Total Compression | Architecture + agents + governance all working. Ship faster, ship right. |
| High Point Compression, Low Total Compression | Agents code fast, but something blocks delivery — slow reviews, CI issues, merge conflicts. Fix the pipeline. |
| Low Point Compression, High Total Compression | Coding took a while, but the feature shipped fast anyway — probably few phases, little review overhead. Consider better decomposition. |
| Low Point Compression, Low Total Compression | Neither agents nor pipeline are performing. Revisit specs, review agent selection, check for governance friction. |
| Compression ratio < 1× | You're slower than human estimates. Something is fundamentally broken — bad decomposition, excessive rework cycles, or agents writing code that fails review. |

## Compression in Slack

When a feature merges, gwrk sends a compression summary to the project's Slack channel:

```
🏆 Feature Shipped: 002-engine-foundation

⚡ Point Compression: 383× (287.5h → 45 min coding)
🚀 Total Compression: 49× (36 days → 17.6 hours elapsed)
💤 Dormancy: 179 days (spec sat untouched)

📊 Overall trend: 161× avg point compression across 6 features
```

---

# 17. Functional Requirements

## FR-1: CLI Orchestration (P0)

| Requirement | Detail |
|---|---|
| **Single-command feature delivery** | `gwrk feature <name>` runs the full pipeline |
| **Pipeline stage commands** | Individual `gwrk specify/plan/tasks/implement/review-*` |
| **Agent backend agnostic** | Works with Gemini CLI, Claude Code, OpenClaw, Codex |

## FR-2: Slack Comms Layer (P0)

| Requirement | Detail |
|---|---|
| **App provisioning** | Fully automated via `gwrk setup slack` (Socket Mode manifest) |
| **Channel-per-project** | `gwrk new` / `gwrk init` creates `#<project-name>` channel |
| **Status notifications** | Phase start/complete, CI results, review verdicts (Block Kit) |
| **Interactive buttons** | Approve/Reject/Retry for reviews |
| **Slash commands** | `/gwrk status`, `/gwrk approve`, `/gwrk dispatch`, `/gwrk pulse`, `/dream` |
| **Threaded DUT** | DUT ideation via project channel threads |
| **Reactions** | ✅ react-to-approve for lightweight confirmation |
| **Presence** | Notification throttling (active=verbose, away=batched) |

## FR-3: Build Server (P0)

| Requirement | Detail |
|---|---|
| **Local daemon** | Persistent `gwrk server` process |
| **Docker sandbox management** | Per-phase container lifecycle |
| **Git tree management** | Automatic branch creation, merge, conflict resolution |
| **PR monitoring** | Poll GitHub for PR and CI status |
| **Context compilation** | Bundle persona + rules + tasks into agent payload |

## FR-4: Parallel Agent Dispatch (P0)

| Requirement | Detail |
|---|---|
| **Phase decomposition** | Plan → parallelizable phases |
| **Concurrent execution** | Multiple sandboxes simultaneously |
| **Merge ordering** | First-finished-first-merged with conflict resolution |
| **Retry logic** | Failed phases re-dispatched with escalation |

## FR-5: Governance Pipeline (P0)

| Requirement | Detail |
|---|---|
| **Spec-first invariant** | No `/implement` without approved `spec.md` + `plan.md` |
| **Workflow personas** | Persona-appropriate behavior per stage |
| **Quality gates** | Checklists must pass before phase start |
| **Review verdicts** | GO/NO-GO decisions with structured reasoning |

## FR-6: Pulse Productivity Dashboard (P1)

| Requirement | Detail |
|---|---|
| **Snapshot generation** | PulseSnapshot with activities + codebase buckets |
| **Historical scan** | `gwrk pulse scan` on any existing git repo |
| **Published/draft separation** | Main branch ↔ published, feature branches ↔ drafts |
| **Weekly buckets** | LOC added/deleted/total per week |
| **Multi-repo aggregation** | Unified view across all tracked repositories |
| **Slack delivery** | `/gwrk pulse` slash command for snapshot summary |

## FR-7: Effort Estimation Engine (P1)

| Requirement | Detail |
|---|---|
| **Story extraction** | Automatic from spec.md stories |
| **Role bracketing** | Stories assigned to RE/TS/PM/PE/DE |
| **Hour derivation** | SP × role rate with 1.25× overhead |
| **Report generation** | Markdown report to `docs/assessments/` |
| **LOC validation** | Optional `cloc` cross-check |

## FR-8: Compression Engine (P0)

| Requirement | Detail |
|---|---|
| **Timestamp collection** | OS file dates, Git commit timestamps, PR merge times, sandbox lifecycle |
| **Active coding detection** | Commit clustering with 30-min gap threshold for session boundaries |
| **Point Compression** | Ratio of estimated coding hours (SP × role rate) to actual commit-active time |
| **Total Compression** | Ratio of estimated elapsed days to actual delivery window (first impl commit → merge) |
| **Dormancy tracking** | Time between spec creation / plan approval and first implementation commit |
| **Per-feature reports** | `gwrk compression <feature>` with full timeline breakdown |
| **Cross-feature summary** | `gwrk compression --all` with trends and best/worst analysis |
| **Slack delivery** | Compression summary posted to project channel on feature merge |

## FR-9: Multi-Agent Dispatch (P0)

| Requirement | Detail |
|---|---|
| **Three backends** | Gemini CLI, Codex CLI, Claude Code — all supported at launch |
| **Agent Router** | Task-type-based routing: implement → Codex, refactor → Claude, define → Gemini |
| **Configurable** | Per-feature, per-phase backend overrides in `.gwrkrc.json` |
| **Headless dispatch** | All agents invoked in non-interactive mode |
| **Done, Done! protocol** | Post-exit verification: tests, lint, build before marking complete |
| **Done, Done! completion protocol** | Post-exit verification: tests, lint, build before marking complete |
| **Retry + escalation** | Up to 3 retries per backend, then fallback to next backend |
| **Tandem dispatch** | Different backends for different phases, simultaneously |
| **Slack escalation** | Human notified in project channel when all backends exhausted |

## FR-10: Agent-DUT Conversational Ideation (P1)
Agent-DUT **MUST** provide a conversational interface via Slack threads for feature ideation, producing a high-quality `spec.md` with effort previews and a [Ship It] confirmation. The DUT protocol aligns to Foxtrot Charlie: Discovery (SPARK → PROBE → DISAMBIGUATE) then Definition (SHAPE → PRESS → GROUND → REVIEW → COMMIT).

## FR-11: Hard Gate Generation (P1)
Agent-DUS **MUST** generate a corresponding shell script `gates/T0xx-gate.sh` for every task it imports into the system. These scripts must contain deterministic assertions (e.g., `test -f`, `grep`, `gh pr status`) that return 0 for pass and 1 for fail.

## FR-12: State-Compliance Enforcement (P1)
The `gwrk tasks done` command **MUST** execute the corresponding gate script before updating the task status to `completed` in `tasks.json`. If the script fails, the command must exit with an error, preventing the implementation agent from proceeding.

## FR-13: Slack App Home Tab (P1)

| Requirement | Detail |
|---|---|
| **App Home Tab** | Slack-native dashboard via Block Kit `views.publish` |
| **Ops View** | Real-time active agents, dispatch queue, system resources |
| **Project Status** | Phase progress bars, gate status per project |
| **Pulse integration** | Pulse and Compression data surfaced in App Home |
| **Quick Actions** | Buttons for dispatch, pulse, view logs |
| **Auto-refresh** | Updated every 30s while App Home is open |

## FR-14: Tunnel (P1)

| Requirement | Detail |
|---|---|
| **Tunnel start/stop** | `gwrk tunnel start/stop` with provider abstraction (cloudflared, tailscale) |
| **Provider config** | `tunnel.provider` in `.gwrkrc.json`, fail-fast if not configured |
| **Default provider** | Cloudflare Tunnel (free, unlimited bandwidth, persistent URL) |
| **Domain config** | User provisions custom domain (e.g., `project.gforge.ai`) |

---

# 18. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **CLI** | TypeScript + Commander.js | Cross-platform, npm distribution |
| **Build Server** | Node.js + Fastify | Lightweight daemon |
| **Comms** | `@slack/bolt` (Socket Mode) | Channel-per-project, threads, App Home Tab, no public URL |
| **Sandbox Runtime** | Docker | Proven isolation (OpenClaw pattern) |
| **Git Operations** | `gh` CLI + `git` | GitHub-native |
| **Agent: Codex** | `codex exec --full-auto` | OpenAI, non-interactive, built-in review, sandbox-write |
| **Agent: Claude** | `claude -p --output-format json` | Anthropic, headless, deepest context window, Agent SDK |
| **Agent: Gemini** | `gemini -p --json` | Google, headless, auto-routing, GEMINI.md context |
| **Pulse Engine** | Git log parser (custom) | No database required for scan mode |
| **Effort Engine** | Markdown parser + SP calculator | Deterministic from spec artifacts |
| **Execution Ledger** | SQLite via `better-sqlite3` | Global `~/.gwrk/gwrk.db`, ADR-002 |
| **Dashboard** | Slack App Home Tab (Block Kit) | Mobile-first, no separate SPA |
| **Tunnel Layer** | Cloudflare Tunnel (default) / Tailscale Funnel | Remote access, persistent URLs |
| **Configuration** | Zod schemas | Fail-fast validation |

---

# 19. Competitive Landscape

| Tool | Category | Strength | What gwrk Adds |
|---|---|---|---|
| **Gemini CLI** | AI Agent | Multi-file reasoning, auto-routing | Orchestration, tandem dispatch, governance, completion protocol |
| **Codex CLI** | AI Agent | Autonomous execution, built-in review | Fleet orchestration, spec pipeline, Slack, Pulse |
| **Claude Code** | AI Agent | Deep context, long refactors | Multi-agent tandem, parallel dispatch, compression tracking |
| **OpenClaw** | AI Gateway | Personal assistant, sandboxing, Telegram | Build/dev orchestration, spec pipeline, multi-backend |
| **Cursor** | AI IDE | Inline code assist | No spec-first pipeline, no headless dispatch, no Slack |
| **GitHub Copilot Workspace** | AI Dev | Issue-to-PR | Cloud-only, single vendor, limited governance |
| **Devin / SWE-Agent** | AI Dev | Autonomous coding | Opaque, single model, no governance, no multi-agent |

### gwrk's Unique Position

The only tool that combines:
1. Governed spec-first pipeline (Foxtrot Charlie)
2. **Multi-agent tandem dispatch** — Gemini, Codex, Claude working simultaneously
3. **Done, Done! completion protocol** — retry + escalate until the work ships
4. Parallel agent dispatch with sandbox isolation
5. **Slack-based multi-project control plane** (channel-per-project, threaded DUT)
6. Productivity dashboard (Pulse) with historical git analysis
7. **Compression metrics** — auditable proof of acceleration
8. SP-driven effort estimation
9. Local-first architecture

---

# 20. Pricing & GTM

## Open Source Core + Commercial Extensions

| Tier | Price | Includes |
|---|---|---|
| **gwrk CLI** | Free (MIT) | CLI, workflows, governance, templates |
| **gwrk Server** | Free (MIT) | Build server, sandboxes, Git management, Slack |
| **gwrk Pulse** | Free (MIT) | Productivity dashboard, git scan |
| **gwrk Cloud** (future) | Paid | Managed cloud agents, hosted Pulse, team features |

## Go-to-Market

1. **Launch on GitHub** — MIT licensed, zero friction
2. **Dogfood relentlessly** — use gwrk to build Code-Red, GForge.ai, and gwrk itself
3. **Slack-first demos** — screen recordings of approving reviews from your phone in Slack
4. **Pulse showcase** — "point gwrk at any repo and see your productivity history"
5. **Integration guides** — setup with every major AI agent
6. **DUT showcases** — "idea on a walk → `/dream` in Slack → shipped PR" screen recordings

---

# 21. Story Map & Story Points

## Implementation Phases

| Phase | Name | Contents | Gate |
|---|---|---|---|
| **0** | **Extraction** | Extract workflows, rules, templates, scripts from Code-Red | `gwrk init` scaffolds correctly |
| **1** | **CLI Core** | `gwrk new/init`, multi-CLI provisioning, `specify/plan/tasks`, SQLite ledger | `gwrk new <project>` scaffolds everything |
| **2** | **Build Server** | Docker sandbox manager, Git tree manager, dispatch queue | `gwrk server start` creates sandboxes |
| **3** | **Slack** | Socket Mode app, Bolt SDK, slash commands, interactive messages, threads, channels | Send status update and approve review from Slack |
| **4** | **WUD Loop** | `gwrk wud` — autonomous implement→review→PR→CI loop, run recording | Agent completes a phase and opens a PR |
| **5** | **Parallel Dispatch** | Multi-phase concurrent execution, conflict resolution | Three agents work simultaneously |
| **6** | **Pulse** | Git log scanner, PulseSnapshot generation, historical scan | `gwrk pulse scan` produces historical data |
| **7** | **Effort + Compression** | Story extraction, role bracketing, compression ratios, leading indicators | `gwrk compression` with convergence/density/spec quality metrics |
| **8** | **Multi-Agent Router** | Agent router, per-backend invocation, SQLite-backed learning, retry + escalation | Dispatch to Codex, retry on Claude, feature ships |
| **9** | **Agent-DUT** | Slack threaded ideation, FC-aligned protocol (SPARK→COMMIT), analyze lens | `/dream` in Slack produces spec.md from threaded conversation |
| **10** | **GForge Integration** | Pulse + Compression replaces PulseStore, unified dashboard | Single pane across repos |
| **11** | **App Home Tab** | Slack App Home Tab with Block Kit: Ops, Projects, Pulse, Compression views | Open gwrk in Slack → see live agent activity |

---

# 22. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Time from `gwrk feature` to merged PR (3-phase feature) | < 2 hours (wall clock) | Build server logs |
| **Average Point Compression across features** | **> 50×** | Compression engine |
| **Average Total Compression across features** | **> 10×** | Compression engine |
| Review decision latency via Slack | < 5 minutes (from notification to approval tap/react) | Slack message timestamps |
| Agent parallelization ratio | ≥ 3 concurrent WUD instances per feature | Sandbox count |
| **Done, Done! completion rate** | **> 95% of phases complete without human escalation** | SQLite `runs` table |
| Merge conflict auto-resolution rate | > 80% | Git manager logs |
| **Multi-backend fallback success rate** | **> 90% (phase completes after retry/escalation)** | SQLite `runs` table |
| `gwrk pulse scan` on 50K-commit repo | < 60 seconds | Benchmark |
| Effort report generation from spec | < 30 seconds | CLI timing |
| `gwrk new` to first `/dream` | < 3 minutes | User testing |
| **DUT: idea-to-spec via Slack thread** | **< 30 minutes of conversation** | DUT thread timestamps |
| **DUT: spec acceptance rate** | **> 80% of DUT specs ship without major revision** | Spec edit history |
| **First-pass gate success rate** | **> 60% (agent's first attempt passes gate)** | SQLite `runs` table |
| **Average compression across features** | **Trending upward over time** | SQLite `compression` table |

---

# 23. Open Questions

| # | Question | Owner | Impact | Status |
|---|---|---|---|---|
| 1 | ~~Which agent backends to support at launch?~~ **All three: Gemini CLI, Codex CLI, Claude Code.** | David | ✅ Resolved | 🟢 Closed |
| 2 | Should the build server require Docker, or also support podman/containerd? | David | Packaging | 🟡 Open |
| 3 | ~~How should gwrk handle LLM rate limits (429)?~~ **Exponential backoff in agent-run.sh (ADR-002, I-WUD-011).** | David | ✅ Resolved | 🟢 Closed |
| 4 | Should Pulse support non-Git sources (e.g., word count from markdown files in a content repo)? | David | Scope | 🟡 Open |
| 5 | ~~Should gwrk ship its own Beads binary?~~ **N/A: gwrk uses SQLite (ADR-002).** | David | ✅ Resolved | 🟢 Closed |
| 6 | How deeply should gwrk integrate with OpenClaw's skill system? Can a gwrk workflow be a skill? | David | Integration | 🟡 Open |
| 7 | ~~Should the comms bot support multi-user teams?~~ **Slack channels support multi-user natively.** | David | ✅ Resolved | 🟢 Closed |
| 8 | Should Pulse separate "authored LOC" from "AI-generated LOC" using commit metadata? | David | Metrics | 🟡 Open |
| 9 | What's the right session-gap threshold for active coding detection? 30 min default — configurable? | David | Compression | 🟡 Open |
| 10 | Should compression count definition time (spec writing, plan review) as effort, or only impl? | David | Compression | 🟡 Open |
| 11 | ~~Should the agent router use historical data to auto-select backends?~~ **Yes. SQLite `runs` table (ADR-002).** | David | ✅ Resolved | 🟢 Closed |
| 12 | How to handle model pricing differences when routing? Codex/Claude/Gemini have different cost profiles. | David | Economics | 🟡 Open |
| 13 | Should Done, Done! verification be customizable per-project (e.g., skip lint, require E2E)? | David | Completion | 🟡 Open |
| 14 | Which LLM backend should power DUT's conversational loop? Same router, or dedicated model for ideation? | David | DUT | 🟡 Open |
| 15 | Should DUT support image input (whiteboard photos, UI sketches) or text/voice only for MVP? | David | DUT | 🟡 Open |
| 16 | ~~Should DUT threads be stored in-repo or only in the Telegram thread?~~ **In-repo at `specs/<feature>/.gwrk/dreams/` AND in Slack thread.** | David | ✅ Resolved | 🟢 Closed |
| 17 | ~~Which tunnel provider should be the default?~~ **Cloudflare Tunnel (free, persistent URL, unlimited bandwidth).** | David | ✅ Resolved | 🟢 Closed |
| 18 | ~~Should the Dashboard support write actions?~~ **App Home Tab includes Quick Action buttons; mutations go through Slack commands.** | David | ✅ Resolved | 🟢 Closed |

---

*gwrk: the Principal Engineer's operating system for AI-assisted development. Dream it. Ship it. Done, done!*
