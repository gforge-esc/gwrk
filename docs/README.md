# 🦩 gwrk Documentation

> **Truth → Clarity → Throughput → Value.**

---

## Reading Order

Start here. Read in this order.

| # | Document | What It Tells You |
|---|---|---|
| 1 | [what-is-gwrk.md](what-is-gwrk.md) | Brand, name, mascot, philosophy, product overview |
| 2 | [foxtrot-charlie.md](foxtrot-charlie.md) | Operating model — the four pillars that drive everything |
| 3 | [architecture.md](architecture.md) | Authoritative tech spec — project structure, stack, pipeline, coding standards |
| 4 | [GWRK-PRD-PRFAQ.md](GWRK-PRD-PRFAQ.md) | Master PRD — exhaustive product definition (91KB, read sections as needed) |

---

## Document Roles

| Document | Role | Primary Audience |
|---|---|---|
| **what-is-gwrk.md** | Brand identity, name etymology, mascot, Foxtrot Charlie mapping | Humans, README |
| **foxtrot-charlie.md** | Operating philosophy — Discovery → Definition → Shipping → Delivery | Humans, agents (context) |
| **architecture.md** | Tech stack, project structure, pipeline spec, coding standards, config contract | **Agents** (`/specify`, `/plan`), humans |
| **GWRK-PRD-PRFAQ.md** | Complete product definition — press release, FAQ, architecture vision, functional requirements, story map | Humans (reference) |

---

## Supporting Documents

### `decisions/` — Architectural Decision Records
| Document | Decision |
|---|---|
| [ADR-001-task-tracking.md](decisions/ADR-001-task-tracking.md) | Flat JSON/JSONL over Beads/Dolt for task tracking (superseded by ADR-002 for storage) |
| [ADR-002-sqlite-execution-ledger.md](decisions/ADR-002-sqlite-execution-ledger.md) | Global SQLite execution ledger for tasks, runs, compression, learning |

### `reference/` — Supporting Material
| Document | Contents |
|---|---|
| [architecture-diagrams.md](reference/architecture-diagrams.md) | Mermaid visualizations — agent pipeline, system architecture, Done Done! protocol, git branching, App Home Tab |
| [codex-lab.md](reference/codex-lab.md) | Codex Cloud integration reference — setup, invocation, orchestration blueprint |
| [extraction-manifest.md](reference/extraction-manifest.md) | Exhaustive inventory of the 78-file CodeRed workflow system being extracted into gwrk |
| [reasoning-modes.md](reference/reasoning-modes.md) | Raw reasoning mode catalogue — 45 modes across 7 categories (source material) |
| [reasoning-skills.md](reference/reasoning-skills.md) | **Compound reasoning skills** — 6 mode stacks purpose-built for gwrk definitional work |

### `.agent/skills/` — Compound Reasoning Skills

Six compound reasoning skills that stack modes from `reasoning-modes.md` into sequenced pass systems for gwrk's definitional workflows. See [reasoning-skills.md](reference/reasoning-skills.md) for full documentation.

| Skill | Modes | gwrk Activity |
|---|---|---|
| **specify-sharpen** | Reductive + Interviewer + Audit | `/specify` — harden specs to executable assertions |
| **decision-forge** | Adversarial + Steel-man + Calibration | Architecture choices, naming, prioritization |
| **truth-extract** | Forensic + Socratic + Uncertainty | `/discover` — separate signal from noise |
| **architecture-stress-test** | Analytical + Pre-mortem + Comparative | `/plan` review — kill bad plans before they kill you |
| **naming-forge** | Dialectical + Aesthetic + Combinatorial | Product naming, CLI taxonomy, category definition |
| **governance-audit** | Audit + Comparative + Integrative | `/analyze` — cross-artifact consistency |
| **signal-cut** | Narrative + Subversive + Practitioner | Marketing content that converts technical skeptics |
| **position-lock** | Reductive + Comparative + Aesthetic | Taglines, pitches, positioning — complex→clear |
| **audience-model** | Modeling + Interviewer + Forensic | User personas, content strategy, demo planning |

### `branding/` — Visual Assets
| Asset | Description |
|---|---|
| [gwrk-flamingo-flat.png](branding/gwrk-flamingo-flat.png) | Crowned Queen mascot — light backgrounds |
| [gwrk-flamingo-neon.png](branding/gwrk-flamingo-neon.png) | Cyberpunk Neon mascot — dark backgrounds |

---

## Agent Guidance

> For agents executing `/specify`, `/plan`, and `/implement` workflows:

| Read | Don't Read |
|---|---|
| **`architecture.md`** — required for every workflow | `GWRK-PRD-PRFAQ.md` — too large for context; sections extracted into architecture.md |
| **`foxtrot-charlie.md`** — for philosophy alignment | `reference/*` — supporting material, not needed for implementation |
| **`specs/000-build-plan.md`** — for dependency context | `decisions/*` — historical decisions, already reflected in architecture.md |
