# OpenClaw Research Report: Architecture, Adoption & Lessons for gwrk

> **Status**: Authoritative — single OpenClaw reference document
> **Created**: 2026-03-14 · **Reconciled**: 2026-03-18
> **Supersedes**: `openclaw-research-openai.md` (deleted), `openclaw-deep-analysis.md` (deprecated — source material only)
> **Purpose**: Distill OpenClaw's architecture, adoption dynamics, and design choices for relevance to gwrk. Contains reconciled integration decisions.

---

## 1. What Is OpenClaw

An open-source autonomous AI agent created by Peter Steinberger (Austrian developer). Originally "Clawdbot" (Nov 2025), renamed to "Moltbot", then "OpenClaw" due to trademark issues. Went viral in early 2026 via the "Moltbook" project. Steinberger joined OpenAI in Feb 2026; project moved to an independent open-source foundation backed by OpenAI.

**Core thesis**: OpenClaw is not a model — it's an **agent runtime** and **execution environment** that orchestrates external LLMs. The LLM provides intelligence; OpenClaw provides the infrastructure (sessions, memory, tool sandboxing, access control, orchestration).

---

## 2. Architecture

### 2.1 Hub-and-Spoke Design

```
                          ┌──────────────┐
              ┌───────────│   Gateway    │───────────┐
              │           │  ws://18789  │           │
              │           └──────┬───────┘           │
              │                  │                   │
    ┌─────────▼──┐    ┌────────▼────────┐   ┌──────▼──────┐
    │  WhatsApp  │    │  Agent Runtime  │   │  Web UI     │
    │  Telegram  │    │  (3-layer arch) │   │  Canvas     │
    │  Discord   │    │                 │   │  CLI        │
    │  WeChat    │    │  L1: LLM APIs   │   │  Mobile     │
    │  iMessage  │    │  L2: pi-mono    │   │             │
    │  Slack     │    │  L3: OpenClaw   │   │             │
    └────────────┘    └─────────────────┘   └─────────────┘
```

**Gateway** (the hub): WebSocket server on `127.0.0.1:18789`. Single point of entry. Handles message routing, session management, validation (JSON Schema on inbound frames). Emits six event types: `agent`, `chat`, `presence`, `health`, `heartbeat`, `cron`. Acts as trust boundary — all incoming messages treated as untrusted.

**Agent Runtime** (the spoke): Three-layer architecture:
- **Layer 1** (Foundation): Standard LLM APIs (Anthropic, OpenAI, local via Ollama)
- **Layer 2** (Abstraction): `@mariozechner/pi-mono` — unified interface for 25+ LLM providers, automatic tool execution loop
- **Layer 3** (Application): OpenClaw itself — messaging integrations, security, memory, browser automation

**Five-stage execution pipeline** per interaction:
1. Session Resolution → identify/load conversation
2. Workspace Bootstrap → identity + skills
3. Context Assembly → session history + memory indices
4. LLM Invocation → call the model
5. Tool Execution → shell, browser, files → persist state

### 2.2 Typed WebSocket Protocol

OpenClaw defines a typed WebSocket protocol:
- **TypeBox schemas** → generate JSON Schema → generate Swift models
- **Mandatory handshake** (`connect` must be first frame)
- **Frame shapes**: `{type:"req", id, method, params}` / `{type:"res", id, ok, payload|error}` / `{type:"event", event, payload}`
- **Schema validation at Gateway boundary**: inbound frames validated against JSON Schema
- **Protocol check CI**: `protocol:gen` scripts + `git diff --exit-code` to enforce generated artifacts stay in sync

### 2.3 Steer-While-Streaming

OpenClaw's agent runtime treats tool call boundaries as commit points. During a streaming agent run, if a new user message arrives, the runtime queues it and injects it "after tool boundaries, skipping remaining tool calls from the current assistant message." This is called **queue mode `steer`** — the operator can redirect a running agent without killing the session.

### 2.4 Exec Approvals

Input-side safety interlock for command execution:
- **Policy file**: `~/.openclaw/exec-approvals.json` with modes: `deny`, `allowlist`, `full`
- **"Ask on miss"**: Unknown command → prompt operator for approval
- **Binding semantics**: Approval bound to a concrete file operand. If operand changes between approval and execution, approval invalidated (prevents TOCTOU drift)

### 2.5 Key Design Choices

| Choice | OpenClaw | gwrk |
|--------|---------|------|
| **Primary interface** | Messaging apps (WhatsApp, Telegram, Discord) | CLI + Slack |
| **Gateway protocol** | WebSocket (`:18789`) | HTTP/Fastify (`:18790`) + WebSocket `/ws` (F015) |
| **Model integration** | Model-agnostic via pi-mono abstraction | CLI-specific AgentBackend adapters (ADR-006) |
| **Execution** | Single Node.js process (Gateway + Runtime) | Separate CLI + daemon + Docker sandboxes |
| **Session model** | Persistent cross-platform sessions | Per-feature branch-scoped state |
| **Memory** | Hybrid memory system (session + long-term) | SQLite ledger + git-native task state |
| **Skills** | `SKILL.md` files + ClawHub marketplace | `.agents/skills/` — two-tier: atomic + compound |
| **Security boundary** | Gateway as trust boundary, pairing system | Sandbox isolation (Docker), spec-first governance |
| **Protocol typing** | TypeBox → JSON Schema → Swift codegen | Zod discriminated unions (TS-only, no codegen) |
| **Safety interlocks** | Input-side exec approvals (allowlist) | Output-side gates + staging validation (4-layer) |

### 2.6 Plugin Architecture (Four Types)

1. **Channel Plugins**: Add messaging platforms (Teams, Mattermost, etc.)
2. **Memory Plugins**: Alternative storage (vector stores, knowledge graphs)
3. **Tool Plugins**: Custom capabilities beyond builtins
4. **Provider Plugins**: Custom/self-hosted LLM providers

Plugins are TypeScript modules loaded at runtime. Can register: Gateway RPC methods, HTTP routes, agent tools, CLI commands, background services. Plugins can introduce their own skills.

**Supply-chain practices**: `--ignore-scripts` on install, path containment, plugin sandboxing.

### 2.7 MCP Integration

OpenClaw runs as an MCP server, allowing external tools (Claude.ai, Cursor, etc.) to integrate. Also consumes MCP servers from external services (Composio, etc.) for tool chaining.

---

## 3. China vs US Adoption

### 3.1 The "Raising Lobsters" Phenomenon

OpenClaw adoption in China became a national phenomenon ("养龙虾" — "raising lobsters") in early 2026. Every major Chinese tech company created a fork:

| Company | Fork Name | Strategy |
|---------|-----------|----------|
| MiniMax | MaxClaw | Simplified one-click install |
| Moonshot AI | KimiClaw | Kimi model integration |
| ByteDance | ArkClaw | TikTok/Douyin ecosystem |
| Baidu | DuClaw | Baidu model integration |
| Zhipu AI | AutoClaw | Enterprise automation focus |
| Tencent | QClaw | WeChat integration |
| Alibaba | JVS Claw | Cloud integration |

### 3.2 Why China Adopted Faster

| Factor | Explanation |
|--------|-------------|
| **Cost** | Deployment cost is pennies (local + cheap API keys). Chinese models (Kimi, MiniMax) are 10-50x cheaper than GPT-4/Claude. |
| **Cultural velocity** | Chinese tech ecosystem embraces FOMO-driven adoption. "If you're not using OpenClaw, you're behind." |
| **WeChat integration** | OpenClaw bots in WeChat groups created viral loops in the dominant messaging platform. |
| **Government subsidies** | Shenzhen's Longgang district and Wuxi city offered subsidies for startups building on OpenClaw. |
| **Domestic model boost** | OpenClaw adoption drove demand for Chinese models, creating a positive feedback loop. |

### 3.3 US Adoption: Slower, Developer-Focused

US adoption is primarily among technical developers and power users. No equivalent viral consumer phenomenon. Key differences:
- US users primarily use it as a **coding agent** (managing Claude Code/Codex sessions)
- China uses it as a **general-purpose personal assistant** (scheduling, email, social media)
- No US government subsidies or major corporate forks

### 3.4 Security Backlash

Chinese government response:
- **Banned** in state-run enterprises and government agencies
- CNCERT issued risk alerts on: default `0.0.0.0` binding, plaintext API key storage, unauthenticated external access, permission control failures during tool execution
- Third-party skills found performing **data exfiltration** and **prompt injection**

> The security issues are real and architectural — OpenClaw's single-process model (Gateway + Runtime) means a compromised skill has access to everything.

---

## 4. Comparative Architecture Summary

| Dimension | OpenClaw | gwrk | Verdict |
|-----------|---------|------|---------|
| **Core metaphor** | Personal AI assistant | Principal Engineer's OS | Different products |
| **Execution model** | Persistent runtime, always-on | Dispatch-and-exit CLI + daemon | gwrk is leaner |
| **State management** | In-memory + file-based sessions | Git-native (tasks.json) + SQLite | gwrk is more rigorous |
| **Security model** | Trust boundary at Gateway | Sandbox isolation + spec-first governance | gwrk is stronger |
| **Agent integration** | Model-agnostic abstraction layer | CLI-specific AgentBackend adapters | OpenClaw is more flexible |
| **Interface** | Messaging-first (WhatsApp, etc.) | Terminal + Slack | Both correct for audience |
| **Skills/Extensions** | `SKILL.md` + ClawHub marketplace | `.agents/skills/` | Same pattern, different scale |
| **Governance** | None — agent runs freely | Foxtrot Charlie, gates, reviews | gwrk is categorically different |
| **Learning** | No execution ledger | SQLite analytical ledger | gwrk learns from operations |
| **Adoption model** | Viral consumer + dev community | Single-user PE tool | Not comparable |

---

## 5. The Deeper Lesson

OpenClaw's explosive adoption proves one thing: **infrastructure for AI agents is the right bet**. Not the models, not the UIs — the execution environment, the session management, the tool orchestration.

gwrk and OpenClaw are building the same *category* of thing (agent runtime / operating system) from opposite ends:
- OpenClaw: consumer-first, breadth-first, messaging-native, no governance
- gwrk: PE-first, depth-first, CLI-native, governance-heavy

The risk for OpenClaw is that breadth without governance produces unreliable outcomes (the Chinese security fiasco proves this). The risk for gwrk is that depth without velocity produces a tool that's correct but never finished.

**The synthesis**: gwrk's Foxtrot Charlie governance prevents the "move fast and break everything" failure. The answer isn't less governance — it's faster loops through the governance.

---

## 6. gwrk Recommendations (Original)

### 6.1 Adopt: Skills as `SKILL.md` ✅ Done

gwrk's `.agents/skills/SKILL.md` structure is identical to OpenClaw's pattern. No marketplace needed — single-user system.

### 6.2 Adopt: Gateway Event Model (Selective)

OpenClaw's six event types are worth studying. gwrk needs heartbeat, cron, and presence.

### 6.3 Adapt: Model Abstraction Layer

Don't adopt pi-mono (wrong abstraction for CLI-invoked agents). Ensure `AgentBackend` interface isolates CLI invocation details from routing logic.

### 6.4 Adapt: "Messaging-First" Insight

The interface the human already lives in should be the primary control surface. For a PE, that's the terminal + Slack. gwrk has this right.

### 6.5 Avoid: Single-Process Architecture

gwrk's separation (CLI → daemon → Docker sandbox) is architecturally superior. Don't regress.

### 6.6 Avoid: Consumer AI Assistant Framing

gwrk is a PE's operating system, not a personal assistant. Depth > breadth.

---

## 7. Integration Reconciliation (2026-03-18)

> **Skills applied**: truth-extract (forensic → socratic → uncertainty), governance-audit (audit → comparative → integrative)

Every actionable item from both source documents has been dispositioned. Items that were adopted have landed in [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md), ADRs, or specs. Items that were rejected have rationale. Future items have triggers.

### ✅ INCLUDED — Landed in architecture, ADR, spec, or code

| # | Item | Source | Where It Landed |
|---|---|---|---|
| 1 | 3-layer plugin model (Agents / Skills / Extensions) | Deep Analysis §1 | [architecture.md §7.1](file:///Users/gonzo/Code/gwrk/docs/architecture.md), [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md), [F014 spec](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md) |
| 2 | Skill plugins (manifest.yaml + SKILL.md, two-tier) | Deep Analysis §1.1 | [skills-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md), F014 P2 |
| 3 | AgentBackend interface (dispatch + parseResult + stdin) | Deep Analysis §1.3 | [ADR-006 §2.1](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md), F004 FR-019/020/021 |
| 4 | Plugin loader + discovery (global → local override) | Deep Analysis §1.4 | [architecture.md §7.5](file:///Users/gonzo/Code/gwrk/docs/architecture.md), F014 P1 |
| 5 | WebSocket hybrid architecture (HTTP + WS) | Deep Analysis §2 | [architecture.md §6.5](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 6 | Event taxonomy (8 event types, Zod-validated) | Deep Analysis §2-3 | [architecture.md §6.5](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 7 | `@fastify/websocket` selected | Deep Analysis §2 | [architecture.md §10](file:///Users/gonzo/Code/gwrk/docs/architecture.md) tech stack |
| 8 | Cron scheduler (`@fastify/schedule`) | Deep Analysis §3 | [architecture.md §6.5](file:///Users/gonzo/Code/gwrk/docs/architecture.md), §10 |
| 9 | Router fold (F008 → F014 P4) | Deep Analysis §4 | [architecture.md §6.4](file:///Users/gonzo/Code/gwrk/docs/architecture.md), [plugin-strategy-audit.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md) |
| 10 | Quota probing → adapter responsibility | Deep Analysis §4 | ADR-006 |
| 11 | Historical learning from SQLite `runs` | Deep Analysis §4 | [architecture.md §6.4](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 12 | Slack as primary ops surface | Deep Analysis §5 | F003 (shipped) |
| 13 | FC loop is domain-neutral | Deep Analysis §6 | Build plan F012 |
| 14 | Workspace bootstrap contract | Research Report §P0 | [ADR-006 §2.2](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md), [architecture.md §7.3](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 15 | Supply-chain guardrails (--ignore-scripts, containment) | Research Report §P1 | [architecture.md §7.6](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 16 | Governance via operating model | Research Report §P1 | Already addressed via Foxtrot Charlie |
| 17 | Dispatch idempotency guard | Research Report §P0 | [dispatch.ts](file:///Users/gonzo/Code/gwrk/src/server/dispatch.ts) — commit `871a02b`, [architecture.md §11](file:///Users/gonzo/Code/gwrk/docs/architecture.md) |
| 18 | `agents.registry` → plugin registry | Deep Analysis §4 | [plugin-strategy-audit.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md) |

### 🔀 TRANSFORMED — Adopted in modified form

| # | Original Recommendation | gwrk Form | Decision |
|---|---|---|---|
| 1 | TypeBox + JSON Schema codegen (§2.2 above) | Zod discriminated unions for WS event frames | gwrk is TS-only. No Swift/Python clients. Same safety, zero new deps. |
| 2 | Exec safety interlocks (§2.4 above) | Gates + staging validation (4-layer safety stack) | Output-verification, not input-permission. Docker sandbox → CLI guardrails → FR-016 staging validation → gates. |
| 3 | HTTP idempotency keys | `enqueue()` dedup guard by featureId+phaseId | Simpler than HTTP idempotency headers. Sufficient for single-user dispatch. |
| 4 | Steer-while-streaming (§2.3 above) | `dispatch:cancel` at stage boundaries via F015 WebSocket | Not full redirect. Cancel-at-stage-boundary only. `dispatch:redirect` deferred → needs F014 P4 routing. |
| 5 | 9-item build sequence | 7-wave strategy in build plan v9 | SP estimates preserved. Sequence reordered for dependency graph. |

### 🔮 FUTURE — Scheduled with trigger

| # | Item | Feature | Wave | Trigger |
|---|---|---|---|---|
| 1 | Channel abstraction (`ChannelPlugin`) | F017 | 7 | F015 + F003 refactor ship |
| 2 | Domain plugins (writing, client engagement) | F016 | 7 | F012 spec written |
| 3 | Knowledge work spec (`gwrk kw --domain`) | F012 | 6 | After F014 P1-3 |
| 4 | Slack live updates via WS | F015 consumer | 5 | F015 ships |
| 5 | Teams support | F017 | 7 | F017 ships |
| 6 | `dispatch:redirect` (backend swap mid-run) | F015 | — | F014 P4 routing intelligence |

### ❌ KILLED — Assessed and rejected

| # | Item | Rationale |
|---|---|---|
| 1 | Workflow pluginification | Workflows are process templates (`.agents/workflows/`), not runtime plugins. Manifest/versioning adds ceremony without value. |
| 2 | SSE as WebSocket alternative | WS is bidirectional (needed for `dispatch:cancel`). SSE is server-push only. |
| 3 | Exec approvals / ask-on-miss | Conflicts with autonomous execution (Pillar 3). Ship loop can't pause for human approval. gwrk safety: Docker sandbox → CLI guardrails → staging validation → gates = 4 layers. |
| 4 | Device pairing + capability advertisement | Single-user local-first. Agents are dispatched, not paired. Docker sandboxes replace node model. |
| 5 | ClawHub-style showcase / gallery | gwrk isn't a public product. No user base to showcase to. |
| 6 | Release channels (stable/beta/dev) + ATLAS threat model | Premature for local single-user tool. Revisit when gwrk has external users. |
| 7 | Cross-platform protocol typing (TypeBox → Swift) | gwrk is TypeScript-only. Zod-for-WS is sufficient. If non-TS clients needed, `zod-to-json-schema` exists. |

### Disposition Summary

| Status | Count |
|---|---|
| ✅ INCLUDED | 18 |
| 🔀 TRANSFORMED | 5 |
| 🔮 FUTURE | 6 |
| ❌ KILLED | 7 |
| **Total** | **36 — zero orphans** |
