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
| [ADR-001-task-tracking.md](decisions/ADR-001-task-tracking.md) | Flat JSON/JSONL over Beads/Dolt for task tracking |

### `reference/` — Supporting Material
| Document | Contents |
|---|---|
| [architecture-diagrams.md](reference/architecture-diagrams.md) | Mermaid visualizations — agent pipeline, system architecture, Done Done! protocol, git branching, Glass Dashboard |
| [codex-lab.md](reference/codex-lab.md) | Codex Cloud integration reference — setup, invocation, orchestration blueprint |
| [extraction-manifest.md](reference/extraction-manifest.md) | Exhaustive inventory of the 78-file CodeRed workflow system being extracted into gwrk |

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
