# gwrk Deep Analysis: Plugin Architecture, Events & Knowledge Work

> **Builds on**: [OpenClaw Research Report](file:///Users/gonzo/.gemini/antigravity/brain/a5fa5ecd-e39b-44be-b0bf-1c91685b8ec0/openclaw_research_report.md)
> **Date**: 2026-03-14

---

## 1. Plugin Architecture for gwrk

### The Case for Plugins Now

gwrk already has plugin-shaped seams:
- **Skills**: `.agents/skills/*/SKILL.md` — reasoning skills loaded by agent context files
- **Workflows**: `.agents/workflows/*.md` — step-by-step patterns referenced by slash commands
- **Agent backends**: `.gwrkrc.json` agent config — different CLI tools per task type
- **Comms**: Slack integration — channel plugin living in `src/server/slack.ts`

These are plugins in spirit but not in contract. Formalizing them delivers two things you asked for: **(1) independent development** of skills/capabilities and **(2) shareability** with friends/collaborators.

### Five Plugin Types for gwrk

```
┌─────────────────────────────────────────────────────────┐
│                    gwrk Plugin System                    │
├──────────┬────────────┬──────────┬──────────┬───────────┤
│ Skill    │ Workflow   │ Agent    │ Channel  │ Domain    │
│ Plugins  │ Plugins    │ Plugins  │ Plugins  │ Plugins   │
└──────────┴────────────┴──────────┴──────────┴───────────┘
```

#### Type 1: Skill Plugins (reasoning extensions)

**What they are**: Compound reasoning skills that teach agents *how to think* about a problem.

**Current state**: `.agents/skills/*/SKILL.md` — already works. Already shareable as directories.

**What formalization adds**:
- **`manifest.json`** alongside `SKILL.md`: declares name, version, compatible agents (gemini/claude/codex), required context, tags
- **Dependency declaration**: Skill X requires Skill Y (e.g., `position-lock` uses `naming-forge` outputs)
- **Install/update via CLI**: `gwrk plugin install skill <path-or-url>` copies to `.agents/skills/`
- **Share via git subtree or npm**: `gwrk plugin publish skill <name>` packages for distribution

```json
// .agents/skills/decision-forge/manifest.json
{
  "type": "skill",
  "name": "decision-forge",
  "version": "1.0.0",
  "description": "Compound reasoning for high-stakes decisions",
  "agents": ["gemini", "claude"],
  "modes": ["adversarial", "steel-man", "calibration"],
  "tags": ["reasoning", "decision", "architecture"]
}
```

#### Type 2: Workflow Plugins (process extensions)

**What they are**: Step-by-step executable patterns for common knowledge work.

**Current state**: `.agents/workflows/*.md` — works but no contract, no versioning.

**What formalization adds**:
- Workflows declare their **inputs** (what files/state they need) and **outputs** (what they produce)
- Workflows declare **gate conditions** (e.g., "spec must exist before plan workflow runs")
- Workflows can be **composed**: `/specify` → `/plan` → `/implement` is a meta-workflow
- Domain-specific workflow packs: "client-engagement-pack", "content-creation-pack"

```yaml
# .agents/workflows/specify.md frontmatter (enhanced)
---
description: Generate a specification from discovery inputs
type: workflow
version: 1.2.0
inputs:
  - fieldnotes (optional)
  - reference docs (optional)
outputs:
  - spec.md
  - checklists/
gates:
  pre: feature directory exists
  post: spec.md passes checklist
tags: [definition, software]
---
```

#### Type 3: Agent Plugins (backend extensions)

**What they are**: Adapters for LLM CLI tools. Each plugin knows how to invoke a specific agent CLI, parse its output, and report results.

**Current state**: Hardcoded in `ship.ts` and `dispatch.ts`. Each agent CLI has its own invocation pattern.

**What formalization adds**:
- **`AgentBackend` interface** extracted from current code into a pluggable contract
- New agents added by dropping a plugin, not editing gwrk core
- Each plugin declares: CLI binary, invocation patterns, output format, cost model, rate limits

```typescript
// Plugin contract (lives in src/plugins/agents/)
interface AgentPlugin {
  name: string;           // 'codex-cloud', 'claude', 'gemini'
  binary: string;         // 'codex', 'claude', 'gemini'
  
  // How to invoke for different task types
  invoke(task: TaskContext): Promise<AgentResult>;
  
  // How to check availability
  isAvailable(): Promise<boolean>;
  
  // Cost/capability metadata for the router
  capabilities: {
    maxContext: number;   // tokens
    parallelism: boolean; // true for cloud agents
    costTier: 'low' | 'medium' | 'high';
    bestFor: string[];    // ['implementation', 'review', 'definition']
  };
}
```

**This IS `008-agent-router`** — the router becomes the plugin host, and each agent backend is a plugin the router selects from. The router's learning (SQLite `runs` table) stays in core. The invocation adapter becomes the plugin.

#### Type 4: Channel Plugins (communication extensions)

**What they are**: Integrations for messaging/notification platforms.

**Current state**: Slack is deeply integrated in `src/server/slack.ts`. No abstraction for other channels.

**What formalization adds**:
- **`ChannelPlugin` interface**: send message, receive command, post update, interactive elements
- Slack remains first-class, but Teams becomes possible without rewriting core
- Future: email digest, calendar integration, webhook endpoints

```typescript
interface ChannelPlugin {
  name: string;           // 'slack', 'teams', 'email'

  // Lifecycle
  start(server: FastifyInstance): Promise<void>;
  stop(): Promise<void>;
  
  // Outbound
  notify(event: GwrkEvent): Promise<void>;
  postDashboard(data: DashboardData): Promise<void>;
  
  // Inbound
  onCommand(handler: CommandHandler): void;
  onAction(handler: ActionHandler): void;
}
```

#### Type 5: Domain Plugins (knowledge work extensions)

**This is the new one.** This is what grows gwrk from a software development assistant to a world-class knowledge work assistant.

**What they are**: Domain-specific skill packs + workflow packs + templates that teach gwrk how to operate in a knowledge domain.

**Example domains**:
- **`gwrk-domain-software`**: What gwrk does today (specs, plans, gates, ship loops)
- **`gwrk-domain-client-engagement`**: Bid response, SOW generation, client research, proposal templates
- **`gwrk-domain-writing`**: Book chapters, blog posts, editing workflows, publishing pipelines
- **`gwrk-domain-comms`**: Professional correspondence, marketing content, pitch decks
- **`gwrk-domain-research`**: Market analysis, competitive intel, synthesis reports

**A domain plugin bundles**:
```
.agents/domains/client-engagement/
├── manifest.json            # type: "domain", dependencies, description
├── skills/
│   ├── truth-extract/       # Reused from core (dependency)
│   ├── audience-model/      # Reused from core
│   └── proposal-forge/      # Domain-specific skill
├── workflows/
│   ├── bid-response.md      # Step-by-step bid process
│   ├── client-research.md   # Research → brief pipeline
│   └── sow-generation.md    # SOW from spec
└── templates/
    ├── proposal-template.md
    ├── sow-template.md
    └── engagement-brief.md
```

**The key insight**: Your existing skills (`truth-extract`, `audience-model`, `position-lock`, `signal-cut`) are **domain-neutral reasoning primitives**. Domain plugins compose these primitives with domain-specific workflows and templates. The reasoning engine stays in core; the domain knowledge is pluggable.

### Plugin Loading Design

```
                    gwrk startup
                        │
              ┌─────────▼──────────┐
              │  Scan plugin dirs   │
              │  .agents/skills/    │
              │  .agents/workflows/ │
              │  .agents/domains/   │
              │  src/plugins/       │  ← Agent + Channel plugins (TypeScript)
              └─────────┬──────────┘
                        │
              ┌─────────▼──────────┐
              │  Validate manifests │
              │  Check dependencies │
              │  Register with core │
              └─────────┬──────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    Skills/Workflows  Agents       Channels
    (Markdown, loaded  (TypeScript,  (TypeScript,
     by agent context   loaded by    loaded by
     files at session   router at    server at
     start)             dispatch)    startup)
```

**Sharing**: Skills, workflows, and domain plugins are pure markdown + JSON — shareable as git repos, npm packages, or just zip files. Agent and channel plugins are TypeScript — shareable as npm packages.

---

## 2. WebSocket vs HTTP: Architectural Tradeoffs

You're right that "simpler" isn't sufficient analysis. Here's the real tradeoff matrix for gwrk's build server:

### The Three Options

| Dimension | HTTP (current) | SSE (Server-Sent Events) | WebSocket |
|-----------|---------------|--------------------------|-----------|
| **Direction** | Request-response | Server → client only | Full duplex |
| **Connection** | New per request | Persistent, one-way | Persistent, bidirectional |
| **Overhead per message** | ~500-1000 bytes headers | ~50 bytes | ~2-14 bytes |
| **Reconnection** | N/A (new connection each time) | Built-in auto-reconnect | Manual (must implement) |
| **Binary data** | ✅ Yes | ❌ Text only | ✅ Yes |
| **Fastify support** | ✅ Native | ✅ Built-in | ✅ `@fastify/websocket` |
| **Slack compatibility** | Slack uses HTTP for slash commands | N/A (Slack uses its own Socket Mode) | N/A |

### Where HTTP Breaks Down for gwrk Over Time

1. **Ship loop monitoring**: Currently, to see ship progress you poll `/api/status`. Each poll creates a new TCP connection, parses headers, does the dance. For watching a 30-minute ship run, that's hundreds of pointless connections.

2. **Slack dashboard updates**: The Slack App Home Tab requires the server to *push* updates. Currently this works because Slack Socket Mode is its own WebSocket. But if you wanted a local web dashboard (future), you'd need push.

3. **Agent heartbeats**: If agents in Docker sandboxes need to report heartbeat/progress to the server, HTTP polling from inside the sandbox is wasteful. WebSocket from sandbox → server is one connection for the life of the agent session.

4. **Cron event distribution**: When a cron job fires (`pulse` every 4 hours, `compression` weekly), the server needs to notify Slack, update dashboards, and potentially trigger dispatches. HTTP can't push these — you'd need the consumers to poll.

### Where WebSocket Overhead Is Justified

For a **single-user local service** on macOS, the WebSocket "overhead" is effectively zero:
- No load balancer concerns
- No proxy traversal issues
- No TLS termination complexity (localhost)
- Memory for one persistent connection: ~50KB
- The `ws` library (used by `@fastify/websocket`) is 50KB, zero deps

### Recommendation: Hybrid — HTTP for Commands, WebSocket for Events

```
┌─────────────────────────────────────────────────────┐
│              gwrk build server (:18790)               │
│                                                       │
│  HTTP Routes (commands, queries)                      │
│  ├── POST /api/dispatch        ← Submit work          │
│  ├── GET  /api/status          ← One-shot query       │
│  ├── POST /api/tasks/done      ← State mutation       │
│  └── GET  /api/health          ← Health check         │
│                                                       │
│  WebSocket (/ws)  (events, streaming)                 │
│  ├── server → client: events                          │
│  │   ├── dispatch:started                             │
│  │   ├── dispatch:progress                            │
│  │   ├── gate:result                                  │
│  │   ├── review:verdict                               │
│  │   ├── cron:pulse                                   │
│  │   ├── heartbeat                                    │
│  │   └── agent:status                                 │
│  └── client → server: commands (future)               │
│      ├── dispatch:cancel                              │
│      └── agent:reassign                               │
└─────────────────────────────────────────────────────┘
```

**Why hybrid**: HTTP for commands preserves CLI compatibility (`curl -X POST` works). WebSocket for events enables real-time Slack updates, future web dashboard, and agent heartbeats without polling. This is exactly what OpenClaw does with its Gateway — HTTP for config/admin, WebSocket for runtime events.

**Implementation path**: Add `@fastify/websocket` to the existing Fastify server. One new route (`/ws`). Event emitters in dispatch, lifecycle, and cron publish to WebSocket clients. Slack integration subscribes as a WebSocket client internally. Low blast radius.

---

## 3. Cron-Style Event System

### Architecture: `@fastify/schedule` + Event Bus

```typescript
// src/server/scheduler.ts
import { fastifySchedule } from '@fastify/schedule';
import { SimpleIntervalJob, AsyncTask } from 'toad-scheduler';

export async function registerScheduledJobs(server, eventBus) {
  await server.register(fastifySchedule);

  // Pulse snapshot every 4 hours
  server.ready().then(() => {
    server.scheduler.addSimpleIntervalJob(
      new SimpleIntervalJob({ hours: 4 }, new AsyncTask('pulse', async () => {
        eventBus.emit('cron:pulse', { timestamp: Date.now() });
      }))
    );

    // Compression check daily at 6am
    server.scheduler.addCronJob(
      new CronJob({ cronExpression: '0 6 * * *' }, new AsyncTask('compression', async () => {
        eventBus.emit('cron:compression', { timestamp: Date.now() });
      }))
    );

    // Agent health check every 5 minutes
    server.scheduler.addSimpleIntervalJob(
      new SimpleIntervalJob({ minutes: 5 }, new AsyncTask('heartbeat', async () => {
        eventBus.emit('heartbeat', { timestamp: Date.now() });
      }))
    );
  });
}
```

### Event Taxonomy

| Event | Trigger | Consumers | Frequency |
|-------|---------|-----------|-----------|
| `cron:pulse` | Every 4 hours | Slack dashboard, SQLite | 6/day |
| `cron:compression` | Daily 6am | Slack summary, SQLite | 1/day |
| `heartbeat` | Every 5 minutes | Lifecycle monitor | 288/day |
| `dispatch:started` | Ship dispatched | Slack, WebSocket | On demand |
| `dispatch:progress` | Agent reports | WebSocket, Slack thread | Continuous |
| `gate:result` | Gate executed | Slack, SQLite | On demand |
| `review:verdict` | Review complete | Slack, ship loop | On demand |
| `agent:status` | Agent alive/idle/done | Router, Slack | On demand |
| `presence:agent` | Agent connect/disconnect | Dashboard | On demand |

**Jobs auto-stop on server shutdown** (`@fastify/schedule` handles this). Cron expressions are configurable via `.gwrkrc.json`, not hardcoded. Single-process — no distributed locking needed for a personal server.

---

## 4. Agent Router as Abstracted Library

Your instinct is right: keep the "use the LLM's CLI" approach, but abstract the interfacing.

### Current State

Agent invocation is scattered across `ship.ts`, `dispatch.ts`, and shell scripts. Each agent CLI has different flags, output formats, and error patterns.

### Target State

```
┌────────────────────────────────────────────────┐
│              Agent Router (008)                  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          Router Core (learning)           │   │
│  │  SQLite runs → success rates → selection  │   │
│  └──────────┬───────────────────────────────┘   │
│             │                                    │
│  ┌──────────▼───────────────────────────────┐   │
│  │       AgentBackend Interface              │   │
│  │  invoke() | isAvailable() | capabilities  │   │
│  └──────────┬───────────────────────────────┘   │
│             │                                    │
│  ┌──────────┼──────────┬──────────┐             │
│  │ Codex    │ Claude   │ Gemini   │ ← Plugins   │
│  │ Plugin   │ Plugin   │ Plugin   │              │
│  │          │          │          │              │
│  │ codex    │ claude   │ gemini   │ ← CLI binary │
│  │ exec     │ -p       │ -p       │              │
│  │ --full-  │ --output │ --json   │              │
│  │ auto     │ -format  │          │              │
│  │          │ json     │          │              │
│  └──────────┴──────────┴──────────┘             │
└────────────────────────────────────────────────┘
```

**The router stays in gwrk core** — it owns the learning loop, the selection algorithm, the fallback chain. **The backend adapters become plugins** — each one knows how to shell out to its CLI, parse stdout/stderr, and return a normalized `AgentResult`.

This means:
- Adding a new model CLI (e.g., Grok CLI, Llama CLI) = add a plugin, not edit core
- Updating invocation flags when a CLI changes = update the plugin, not router
- Testing each backend independently = plugin has its own test file
- Sharing agent configurations = plugin + `.gwrkrc.json` entry

---

## 5. Slack/Teams as Primary Interface

### The Vision: Slack Is the Dashboard, Not an Integration

Current Slack is operational: slash commands + App Home Tab. The goal: **Slack becomes the primary control and visibility surface**.

| Capability | Current | Target |
|-----------|---------|--------|
| Ship dispatch | `/gwrk ship` triggers dispatch | Same, but with interactive thread updates |
| Status | `/gwrk status` returns text | App Home Tab with live stats (via WebSocket → Slack) |
| Logs | `/gwrk logs` returns file dump | Inline log streaming in Slack thread |
| Review | Agent posts review to channel | Interactive Slack message with GO/NO-GO buttons |
| Pulse | CLI only | Cron-triggered Slack digest every 4 hours |
| Alerts | No alerts | Push to Slack on gate failure, agent crash, drift |
| Discovery | CLI only | `/gwrk discover` returns rich Block Kit card |

### Teams Support Path

The `ChannelPlugin` interface (Type 4 above) makes Teams possible:
1. Extract current Slack code into a `SlackChannel` plugin implementing `ChannelPlugin`
2. Build `TeamsChannel` plugin against the same interface
3. `.gwrkrc.json` declares which channels are active

**Not now.** Slack first, but the abstraction makes Teams a plugin, not a rewrite.

---

## 6. Knowledge Work Expansion

### The Domain Model

```
                        gwrk
                         │
            ┌────────────┼─────────────┐
            │            │             │
         Pillars     Primitives     Domains
         (FC Loop)   (Reasoning)   (Knowledge)
            │            │             │
     ┌──────┼──────┐     │      ┌──────┼──────┐
     │      │      │     │      │      │      │
  Discover Define Ship   │   Software Client Writing
                         │              Comms  Research
                         │
              ┌──────────┼──────────┐
              │          │          │
         truth-     decision-  audience-
         extract     forge      model
         signal-    position-  naming-
         cut         lock       forge
         specify-   governance-
         sharpen     audit
```

**Key insight**: The four pillars (Discover → Define → Ship → Deliver) are domain-neutral. They work for software AND for bids AND for client communication AND for writing:

| Pillar | Software | Client Engagement | Writing |
|--------|----------|-------------------|---------|
| **Discover** | Fieldnotes, market signal | Client research, RFP analysis | Topic research, source material |
| **Define** | spec.md, plan.md | Proposal, SOW, engagement brief | Outline, chapter structure |
| **Ship** | Autonomous implementation | Draft generation, review cycles | Writing, editing, revision |
| **Deliver** | UAT, deployment | Client presentation, delivery | Publication, distribution |

**The Foxtrot Charlie loop applies to ALL knowledge work.** What changes per domain is:
- The **templates** (spec template vs proposal template vs chapter template)
- The **workflows** (implement vs draft vs respond)
- The **skills** (specify-sharpen works everywhere; proposal-forge is domain-specific)
- The **gate criteria** (tests pass vs client accepted vs editor approved)

### How Domain Plugins Enable This

```bash
# Install a domain pack
gwrk plugin install domain client-engagement

# Now these workflows are available
gwrk kw specify --domain client-engagement   # Uses proposal template
gwrk kw plan --domain client-engagement      # Uses engagement plan template
gwrk discover fieldnote --domain client-engagement  # Tags with domain context

# Skills compose across domains
gwrk kw specify --domain client-engagement
# → Internally uses: truth-extract (core) + audience-model (core) + proposal-forge (domain)
```

### The Knowledge Work Command Surface

```
gwrk discover   →  Truth extraction (all domains)
gwrk kw         →  Knowledge work (domain-aware definition)
gwrk ship       →  Autonomous execution (software domain only, for now)
gwrk deliver    →  Value realization (domain-aware)
```

`gwrk kw` already exists. It needs the domain-awareness layer: a `--domain` flag (or auto-detected from project structure) that selects the right templates, workflows, and skills.

---

## 7. Incremental Build Sequence

This is a lot. Here's the order that delivers value fastest:

| Priority | What | Why First | Est. Effort |
|----------|------|-----------|-------------|
| **P0** | `manifest.json` for skills | Enables sharing immediately | 2 SP |
| **P0** | `@fastify/schedule` integration | Cron events for pulse/compression automation | 3 SP |
| **P1** | WebSocket route (`/ws`) on build server | Event streaming foundation | 5 SP |
| **P1** | `AgentBackend` interface extraction | Unblocks 008-agent-router cleanly | 3 SP |
| **P1** | Plugin loader for skills/workflows | `gwrk plugin install/list` | 5 SP |
| **P2** | Domain plugin structure | Enables client-engagement + writing domains | 5 SP |
| **P2** | Slack → `ChannelPlugin` extraction | Unblocks Teams (later) | 5 SP |
| **P3** | `gwrk kw --domain` flag | Domain-aware knowledge work | 3 SP |
| **P3** | Event taxonomy formalization | All events typed, all consumers registered | 3 SP |

**Total**: ~34 SP across 9 items. These would be future features in the build plan, not immediate work.

The most impactful thing you can do *today*: add `manifest.json` to your existing skills so they're shareable. Everything else builds on top.
