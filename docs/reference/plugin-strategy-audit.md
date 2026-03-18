# Feature Audit Matrix — Plugin Strategy Surface Contact

> **Purpose:** Identify which of gwrk's features (000–017) are touched by the F014 Plugin System. Organized to inform the 014 spec as both remediation/rework and greenfield input.
> **Foundation:** Features **000**, **004**, and **013** constitute the most learning and coherence with gwrk's vision. All assessments are relative to the standard they set.
> **Date:** 2026-03-17

---

## Audit Summary

| Contact Type | Features | Count |
|---|---|---|
| **F014 IS the feature** | 014 | 1 |
| **Direct Adapter** — needs AgentBackend plugin | 004, 008 | 2 |
| **Service Consumer** — calls through plugin layer | 001, 005, 012 | 3 |
| **Framework Provider** — provides infrastructure plugins consume | 002, 013, 000-TDD | 3 |
| **Plugin Type Provider** — defines a new plugin surface | 003, 017, 016 | 3 |
| **Untouched** — no plugin surface contact | 000, 006, 007, 009, 010, 011, 015 | 7 |

---

## Group 1: Direct Adapter (AgentBackend plugin is the integration point)

### F004 — Ship Loop 🔴 (Active — TDD hardening)

**Contact:** F004's `work-until-done.sh` and `agent.ts` currently hardcode CLI dispatch (`claude -p`, `gemini -p`, `codex exec`). This is the **primary consumer** of the `AgentBackend` plugin.

**Current state:** Strongest implementation alongside 000/013. Has contracts, gates, plans, reviews, TDD infrastructure. Ship loop is the execution kernel.

**What F014 changes:**
- `agent.ts` dispatch call → `pluginRegistry.getAgentBackend().dispatch()`
- `agent-run.sh` regex exit code parsing → `backend.parseResult()` normalization
- Hardcoded `--yolo` / `--full-auto` / `--dangerously-skip-permissions` → `backend.dispatch()` encapsulates
- Prompt assembly stays in gwrk core (spec + contracts + gates); delivery moves to plugin

**Remediation scope:** Moderate. F004 is well-structured — the dispatch boundary is clean. Rework is surgical: swap the spawn call site, not the orchestration logic.

**Tie to 013:** F004 already consumes F013 contracts (`--format json`, `[exit:N | Xs]`, `gwrk gate-check`). Plugin adapters inherit these contracts. No conflict.

---

### F008 — Multi-Agent Router (Spec only, no code)

**Contact:** F008's spec explicitly declares F014 dependency. The agent registry (`.gwrkrc.json → agents.registry`) and quota-based routing are **consumer-side logic** that dispatches through `AgentBackend` plugins.

**Current state:** First-blush spec (2026-03-10). Not TDD-hardened. No contracts, no implementation. Uses hardcoded backend names (`codex`, `gemini`, `claude`) throughout.

**What F014 changes:**
- Agent registry → plugin discovery. `pluginRegistry.getAgentBackends()` replaces `loadRegistry()` from `.gwrkrc.json`
- Quota probing → plugin responsibility. Each adapter knows how to check its own quota
- Fallback chain → plugin metadata. Adapter manifests declare `preferredAgent`, `fallbackAgent`
- Context size estimation → plugin-declared `maxInputTokens`

**Remediation scope:** Heavy. Spec needs rewrite to use F014 plugin interfaces instead of `.gwrkrc.json` registry. The core routing logic (quota-based selection, fallback chain, backoff) survives but the data source changes entirely.

**Risk:** F008 spec was written before ADR-006. Its agent registry schema conflicts with the `AgentBackend` interface. Must be reconciled before implementation.

---

## Group 2: Service Consumer (calls through plugin layer, doesn't define plugins)

### F001 — CLI Core ✅ (Shipped, not TDD-hardened)

**Contact:** F001 owns `dispatchAgent()` in `agent.ts` — the current (hardcoded) dispatch function. F014 replaces this with the plugin registry call.

**What F014 changes:**
- `src/utils/agent.ts` → deprecated or refactored to thin wrapper around plugin dispatch
- `gwrk new` provisioning → must invoke `plugin.syncGovernance()` to generate `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` from `.gwrk/agent-context.md`
- `gwrk init` → must detect existing CLI config files and run conflict detection (ADR-006 §2.5)

**Remediation scope:** Light-moderate. `agent.ts` is already a clean utility — replacing its internals with plugin dispatch is straightforward. The provisioning commands (`new`, `init`) need a plugin hook but the structure exists.

---

### F005 — Parallel Dispatch (Spec only, no code)

**Contact:** F005 dispatches multiple agents concurrently. Each dispatch goes through an `AgentBackend` plugin. Capacity gating (`maxConcurrent`, `rateLimit`) moves to plugin metadata.

**What F014 changes:**
- Per-backend capacity → declared in plugin manifest, not `.gwrkrc.json`
- Sandbox creation → unaffected (git clone logic stays in gwrk core)
- Rate limit handling → plugin adapter can declare its 429 behavior

**Remediation scope:** Moderate. Spec needs update to reference plugin capacity metadata instead of hardcoded registry. Core sandbox/merge logic is plugin-agnostic.

---

### F012 — Knowledge Work (README only, no spec)

**Contact:** Build plan explicitly declares F014 dependency. `--domain` flag dispatches to domain plugins. Knowledge work workflows are plugin consumers.

**What F014 changes:**
- `gwrk kw specify --domain writing` → loads domain plugin, gets domain-specific templates
- Fieldnote capture → domain plugins can define custom fieldnote types
- Discovery compilation → domain plugins can contribute to digest assembly

**Remediation scope:** Greenfield. No spec exists (only README). Must be written from scratch with F014 plugin interfaces in mind. **This is net-new work, not rework.**

---

## Group 3: Framework Provider (provides infrastructure that plugins consume)

### F000-TDD — TDD Infrastructure ✅ (Shipped, merged)

**Contact:** ADR-005's `GateBrief` interface has a `projectType: "gwrk-typescript"` field explicitly designed for F014 extensibility. Gate authoring strategy (deterministic vitest vs LLM-authored) is dispatched per project type.

**What F014 changes:**
- `projectType` → resolved from plugin metadata. A Python project's plugin would declare `projectType: "python-pytest"` and provide a different gate generation strategy.
- `generateVitestGates()` → becomes the default gate strategy, overridable by plugin

**Remediation scope:** None now. The extensibility hook is already designed in. Implementation happens when F014 introduces project-type plugins (not in initial release).

**Strength:** This is the strongest example of forward-compatible design in gwrk. ADR-005 anticipated F014 without coupling to it.

---

### F013 — Agent-Native Interface ✅ (Strongest spec)

**Contact:** F013 defines the contracts that ALL plugins must honor: `--format json`, `[exit:N | Xs]`, `--agent` mode, exit code standardization, error-as-navigation, help text enrichment. Plugins are F013 consumers, not modifiers.

**What F014 changes:**
- F013 contracts are **inherited, not changed.** `AgentBackend.dispatch()` produces output that gets wrapped in F013's signal envelope.
- `gwrk project discover` → should include plugin inventory in its output
- `gwrk gate-check` → unaffected (gates are gwrk-internal, not plugin-dependent)

**Remediation scope:** Minimal. Add plugin metadata to `project discover` output. Everything else is consumer-side.

**Strength:** F013's two-layer architecture (Layer 1 Unix, Layer 2 Agent) is exactly the model that `AgentBackend` plugins follow. The clean stdin/stdout/stderr contract means plugin adapters compose naturally.

---

### F002 — Build Server ✅ (Shipped, not TDD-hardened)

**Contact:** The build server's dispatch queue currently routes to hardcoded backends. F014 replaces the routing logic but doesn't change the server architecture.

**What F014 changes:**
- `dispatch.ts` processNext() → resolves backend via plugin registry instead of hardcoded map
- Health endpoint → should include plugin backend status (available/degraded/offline)

**Remediation scope:** Light. Dispatch queue structure survives. Only the backend resolution call changes.

---

## Group 4: Plugin Type Provider (defines a new plugin surface)

### F003 — Slack ✅ (Shipped, not TDD-hardened)

**Contact:** F003 becomes the reference implementation for `ChannelPlugin` (F017). The existing Slack code must be refactored to implement a plugin interface.

**What F014 changes:**
- `slack.ts`, `slack-commands.ts`, `slack-actions.ts` → must implement `ChannelPlugin` interface
- Slack-specific code stays but is wrapped behind a plugin boundary
- A non-Slack channel (Teams, Discord, CLI-only) should be possible via a different plugin

**Remediation scope:** Heavy. The Slack implementation is tightly coupled to the build server. Extracting a clean `ChannelPlugin` interface requires significant refactoring. **F017 depends on this.**

---

### F016 — Domain Packs (No spec, no code)

**Contact:** F016 IS a plugin type. Domain packs are the first non-skill, non-agent plugin surface.

**Remediation scope:** Greenfield. Must be designed alongside F014.

---

### F017 — Channel Abstraction (No spec, no code)

**Contact:** F017 IS a plugin type. `ChannelPlugin` interface decouples comms from Slack.

**Remediation scope:** Greenfield. Depends on F003 refactor + F014 plugin loader.

---

## Group 5: Untouched by Plugin Strategy

| Feature | Why Untouched | Current State |
|---------|---------------|---------------|
| **F000** (Extraction) | Bootstrap asset copy. No runtime behavior. | ✅ Complete |
| **F006** (Pulse) | Git log scanner. Pure computation, no agent dispatch. | Spec only |
| **F007** (Effort) | SP estimation engine. Pure computation. | Spec only |
| **F009** (Agent-DUT) | Slack-native ideation. Consumes Slack, doesn't define plugins. | Spec only |
| **F010** (GForge Integration) | Dashboard aggregation. Consumes F006+F007 output. | Spec only |
| **F011** (Harvest) | Post-merge lifecycle. Consumes Ship Loop output, webhooks. | Spec only |
| **F015** (Event Bus) | WebSocket infrastructure. Plugin events could flow through it eventually, but F015 itself is plugin-unaware. | No spec |

---

## Remediation Priority Matrix

Ordered by **impact on F014 spec quality** (what should inform the spec first):

| Priority | Feature | Action for 014 Spec | Type |
|----------|---------|---------------------|------|
| **P0** | F004 (Ship Loop) | Define `AgentBackend.dispatch()` contract from F004's actual dispatch call sites | Rework |
| **P0** | F013 (Agent-Native) | Inherit F013 contracts into plugin interface spec (exit codes, signals, `--format json`) | Inherit |
| **P0** | F000-TDD | Inherit `projectType` extensibility from ADR-005 into plugin manifest | Inherit |
| **P1** | F008 (Agent Router) | Rewrite spec to use plugin registry instead of `.gwrkrc.json` agent registry | Rework |
| **P1** | F001 (CLI Core) | Define plugin hook for `gwrk new`/`gwrk init` provisioning | Rework |
| **P1** | ADR-006 | Finalize `AgentBackend` interface, config ownership, conflict detection | New |
| **P2** | F005 (Parallel) | Update spec to reference plugin capacity metadata | Rework |
| **P2** | F002 (Build Server) | Update dispatch queue to use plugin registry | Rework |
| **P2** | F003 (Slack) | Begin `ChannelPlugin` interface extraction planning | Rework |
| **P3** | F012 (Knowledge) | Write spec with `--domain` plugin interface from the start | Greenfield |
| **P3** | F016 (Domain Packs) | Define domain plugin type alongside F012 | Greenfield |
| **P3** | F017 (Channel) | Define `ChannelPlugin` interface (depends on F003 refactor) | Greenfield |

---

## Key Insight: The Plugin Strategy Has Three Layers

```
Layer 1: AgentBackend Plugins    ← F004, F005 consume these
         (Claude, Codex, Gemini adapters)
         ADR-006 defines the contract.

Layer 2: Skill Plugins           ← Current F014 spec covers this well
         (Atomic reasoning modes, compound compositions)
         Skills architecture docs define the contract.

Layer 3: Extension Plugins       ← F016, F017 define new types
         (Domain Packs, Channel Adapters)
         Not yet designed. Greenfield.
```

The F014 spec currently focuses on **Layer 2 (Skills)**. ADR-006 establishes **Layer 1 (Agent Backends)**. **Layer 3 (Extensions)** is entirely unspecified. The 014 spec must be expanded to cover all three layers.

---

## F008 → F014 Fold Recommendation

> **Decision:** Fold F008 (Agent Router) into **F014 Phase 4: Routing Intelligence.**
> **Confidence:** 8/10. Full analysis: [f008-fold-decision.md](../../.gemini/antigravity/brain/30911eb8-0c80-46b3-b1e9-f77e158b1894/f008-fold-decision.md)

**Rationale:** F008's agent registry (`.gwrkrc.json → agents.registry`) conflicts with F014's plugin registry — same domain, different schemas. F008's quota probing is CLI-specific knowledge that belongs in adapter plugins per ADR-006. Rewriting F008 to consume plugin metadata produces the same artifact as "F014 Phase 4." The routing *intelligence* (quota-weighted selection, fallback chains, historical learning) survives intact as a core module.

| F008 Component | Destination in F014 |
|---|---|
| `agents.registry` (DM-001) | Replaced by `pluginRegistry.getAgentBackends()` |
| `QuotaProber` (FR-002) | Moves into each `AgentBackend` adapter plugin |
| `quota-cache.json` (DM-003) | Managed by plugin adapter, not gwrk core |
| `selectBackend()` (FR-001) | F014 Phase 4: `src/engine/router.ts` |
| `routing_decisions` table (DM-002) | Survives unchanged (SQLite is gwrk-internal) |
| `fallbackOrder` config | Project config (`.gwrkrc.json`), not plugin schema |
| Historical learning (FR-006) | Survives — queries `runs` table |

**Build plan impact:** F008 retired as standalone. F014 SP: 8 → 20 (absorbs F008's 12). F005 depends on F014 Phase 4, not F008.

---

## Implementation Priority Order

The hardening formula per feature:
```
gwrk define spec → gwrk define plan → gwrk define tests → gwrk define tasks --reconcile → gwrk ship
```

| Order | Feature | Type | Work | SP Est. |
|-------|---------|------|------|---------|
| **1** | F004 (Ship Loop) | Rework | Add dispatch facade (`TaskDispatch → TaskResult`), plugin-ready contract | 3 |
| **2** | F014 P1-3 (Plugin System) | Greenfield | Plugin loader, registry, skill runtime, Layer 1 adapters | 12 |
| **3** | F014 P4 (Routing Intelligence) | Absorbed from F008 | Quota probing, backend selection, fallback, historical learning | 8 |
| **4** | F001 (CLI Core) | Rework | Swap `agent.ts` dispatch for plugin call. Update `gwrk new`/`init` | 3 |
| **5** | F005 (Parallel Dispatch) | Rework | Update spec for plugin capacity metadata | 3 |
| **6** | F002 (Build Server) | Light rework | Update `dispatch.ts` to use plugin registry | 2 |
| **7** | F003 (Slack) | Heavy rework | Begin `ChannelPlugin` extraction (prerequisite for F017) | 5 |
| **8** | F012 (Knowledge Work) | Greenfield | Write spec with `--domain` plugin interface | 8 |
| **9** | F016, F017 | Greenfield | Domain packs + channel abstraction (Layer 3) | 16 |

