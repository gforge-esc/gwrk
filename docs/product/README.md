# 🦩 gwrk Documentation

> **Truth → Clarity → Throughput → Value.**

---

## Reading Order

Start here. Read in this order.

| # | Document | What It Tells You |
|---|---|---|
| 1 | [what-is-gwrk.md](WHAT_IS_GWRK.md) | Brand, name, mascot, philosophy, product overview |
| 2 | [foxtrot-charlie.md](FOXTROT-CHARLIE.md) | Operating model — the four pillars that drive everything |
| 3 | [architecture.md](../grounding/architecture.md) | Authoritative tech spec — project structure, stack, pipeline, coding standards |
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
| [ADR-001-task-tracking.md](../decisions/ADR-001-task-tracking.md) | Flat JSON/JSONL over Beads/Dolt for task tracking (superseded by ADR-002 for storage) |
| [ADR-002-sqlite-execution-ledger.md](../decisions/ADR-002-sqlite-execution-ledger.md) | Global SQLite execution ledger for tasks, runs, compression, learning |

### Skills

[gwrk-plugins](https://github.com/gforge-esc/gwrk-plugins) lists installable plugins. The [reasoning modes taxonomy](../archive/reference/reasoning-modes.md) supplies the seed command.

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
