# Implementation Plan: Plugin Architecture & Knowledge Work Expansion

> **Anchored to**: [Build Plan v8](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md)
> **Research**: [OpenClaw Research Report](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md)
> **Validation**: [Manifest Stress Test](file:///Users/gonzo/.gemini/antigravity/brain/a5fa5ecd-e39b-44be-b0bf-1c91685b8ec0/skill_manifest_stress_test.md)

## Locked Decisions

| Decision | Choice |
|----------|--------|
| Plugin scoping | Model C: `~/.gwrk/plugins/` global, `.gwrk/plugins.yaml` local override |
| Config format | YAML for all user-facing config |
| Skill interface | CLI-native: `gwrk skill <name>` with full F013 contract |
| MCP stance | Not adopted — context-oblivious, server-coupled, not composable |
| Skill hierarchy | **Two-tier: atomic skills (modes) + compound skills** |
| Manifest boundary | manifest.yaml = contract, SKILL.md = reasoning program |

---

## Two-Tier Skill Hierarchy

Reasoning modes from `reasoning-modes.md` ARE skills — atomic, single-pass, independently invocable.

```
Skills
├── Atomic (single reasoning mode, 1 pass)
│   ├── narrative        ← "Frame as story arc"
│   ├── subversive       ← "Violate the expected approach"
│   ├── practitioner     ← "Monday morning test"
│   ├── forensic         ← "Work backward from outcomes"
│   ├── reductive        ← "Strip to ground truth"
│   ├── adversarial      ← "Attack the idea"
│   ├── interviewer      ← "Ask before declaring"
│   ├── audit            ← "Map every assumption"
│   └── ... (40+ from taxonomy)
│
└── Compound (compose atomics, multi-pass)
    ├── signal-cut       ← narrative → subversive → practitioner
    ├── specify-sharpen  ← reductive → interviewer → audit
    ├── decision-forge   ← adversarial → steel-man → calibration
    ├── truth-extract    ← forensic → socratic → uncertainty
    └── ...
```

**This means**:

- `gwrk skill narrative < brief.md` — invoke a single reasoning mode
- `gwrk skill signal-cut < brief.md` — invoke a compound (runs all 3 passes)
- `gwrk skill narrative < brief.md | gwrk skill practitioner` — compose atomics via pipes
- Compound skills declare `composes: [narrative, subversive, practitioner]` — references to atomic skill names

### Atomic Skill Manifest

```yaml
# ~/.gwrk/plugins/skills/narrative/manifest.yaml
type: skill
name: narrative
tier: atomic
version: 1.0.0
description: "Frame content as story arc with tension, turn, resolution"
category: creative    # From reasoning-modes.md categories
prompt: >
  TURN THIS INTO A STORY ARC. WHAT'S THE TENSION, THE TURN, THE RESOLUTION?

interface:
  input: stdin
  output: stdout
  exitCodes:
    0: success
    1: failed
    2: usage error

runtime:
  preferredAgent: gemini
  maxInputTokens: 16000

tags: [reasoning, creative, narrative]
```

### Compound Skill Manifest

```yaml
# ~/.gwrk/plugins/skills/signal-cut/manifest.yaml
type: skill
name: signal-cut
tier: compound
version: 1.0.0
description: >
  Compound skill for marketing content that converts skeptical technical
  audiences. Combines narrative, subversive, and practitioner modes.

composes:
  - narrative
  - subversive
  - practitioner

passes:
  - name: narrative
    skill: narrative
    summary: "Frame as story arc with tension, turn, resolution"
  - name: subversive
    skill: subversive
    summary: "Violate the expected approach for this content type"
  - name: practitioner
    skill: practitioner
    summary: "Strip what fails the Monday morning test"

interface:
  input: stdin
  output: stdout
  flags:
    - name: --content-type
      values: [launch-post, blog, social-thread, demo-script, newsletter]
      required: false
    - name: --audience
      default: "skeptical technical practitioners"
    - name: --product
      description: "Product name for voice context"
  exitCodes:
    0: success
    1: generation failed
    2: usage error

context:
  required: [input]
  optional: [audience, product, content-type]

outputContract:
  - "Has a recognizable tension the reader has lived through"
  - "Does NOT follow the expected template for its content type"
  - "Contains at least one concrete demonstration"
  - "Passes the 'would a PE forward this?' test"
  - "Has one clear call to action that isn't 'sign up'"

runtime:
  preferredAgent: gemini
  fallbackAgent: claude
  maxInputTokens: 16000
  expectedLatency: "10-30s"

tags: [content, marketing, writing, developer-tools]
```

### Boundary Rule

> **manifest.yaml** = *what is this, what does it need, what does it produce*
> **SKILL.md** = *how does this think* (detailed pass instructions, prompt injections, playbook tables, examples)

---

## Plugin Scoping

```
~/.gwrk/plugins/                ← Global (canonical install)
├── skills/                     ← Global only
│   ├── narrative/              ← Atomic
│   ├── subversive/             ← Atomic
│   ├── signal-cut/             ← Compound
│   └── specify-sharpen/        ← Compound
├── workflows/                  ← Global default, local override/add
├── agents/                     ← Global only
├── channels/                   ← Global only
└── domains/                    ← Global default, local disable

/project/.gwrk/                 ← Local (operational + overrides)
├── tasks.json
├── plugins.yaml                ← Override/disable (optional)
└── plugins/workflows/          ← Project-specific additions only
```

---

## Proposed Features

### Phase α — Foundation

#### [NEW] F014 — Plugin System (8 SP)

- Manifest schema (YAML) with two-tier skill hierarchy
- Global `~/.gwrk/plugins/` directory
- Local `.gwrk/plugins.yaml` override/disable
- Plugin loader: global → local → register
- **Skill runtime**: `gwrk skill <name>` with F013 contract
- CLI: `gwrk plugin install|remove|list|disable|enable`
- Migration: `.agents/skills/` → `~/.gwrk/plugins/skills/` with manifests
- Atomic skills generated from `reasoning-modes.md` taxonomy

**Deps**: F001 ✅

#### [NEW] F015 — Event Bus & Scheduler (8 SP)

- WebSocket `/ws` via `@fastify/websocket`
- Event taxonomy: `dispatch:*`, `gate:*`, `cron:*`, `heartbeat`, `agent:*`
- `@fastify/schedule` cron: pulse (4h), compression (daily), heartbeat (5min)

**Deps**: F002 ✅

### Phase β — Intelligence

#### [AMEND] F008 — Agent Router + Plugins (+5 SP → 12 SP)

`AgentBackend` interface, adapter plugins at `~/.gwrk/plugins/agents/`. Router core stays in `src/engine/`.

**Deps**: F014, F005

#### [AMEND] F012 — Knowledge Work + Domains (+5 SP → 13 SP)

`--domain` flag, domain plugins, built-in `software` domain, Foxtrot Charlie as domain-neutral loop.

**Deps**: F014, F001 ✅

### Phase γ — Expansion

#### [NEW] F016 — Domain Packs (13 SP)

`client-engagement`, `writing`, `comms`, `research` domain plugins.

**Deps**: F012 amendment, F014

#### [NEW] F017 — Channel Abstraction (8 SP)

`ChannelPlugin` interface, Slack refactor, event subscription, Teams (stretch).

**Deps**: F014, F015, F003 ✅

---

## Build Plan Impact

| Wave | Addition |
|------|----------|
| Wave 4 | **+ F014** |
| Wave 5 | **+ F015**, F008 expanded |
| Wave 6 | F012 expanded |
| Wave 7 | **F016, F017** |

**Total**: +47 SP (163 → 210 SP)
