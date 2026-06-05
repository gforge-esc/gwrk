---
initiative: R008-ontology-and-identity
prefix: R008
methodology: ontological-synthesis
status: active
created: 2026-06-05
deliverable: docs/product/WHAT_IS_GWRK.md (rewrite)
references:
  - docs/product/FOXTROT-CHARLIE.md
  - docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md
  - docs/archive/reference/reasoning-skills.md
  - docs/research/R007-project-perspective/references/ontology-construction-prompt.hbs
  - docs/research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md
---

# R008: Ontology & Identity — What Is gwrk?

> **Deliverable:** A rewritten `WHAT_IS_GWRK.md` that is brilliant, honest, and grounded in the ontological structure of what gwrk actually is.
> **This is not a feature.** This is a positioning document produced through domain analysis.
> **Consumer:** README, product communications, onboarding, and the gwrk project's own self-understanding.

---

## Objective

Answer the question **"What is gwrk?"** with ontological precision — not with a feature list, not with aspirational claims, not with persona names that leak internal implementation. The current `WHAT_IS_GWRK.md` is self-referential (describes gwrk in terms of gwrk) and factually incorrect (lists capabilities that don't exist: Docker sandboxes, Codex Cloud, App Home Tab, `gwrk new`, `gwrk specify`, `gwrk dispatch`).

The rewrite must do three things:

1. **Define gwrk's domain ontology** — what are its primitive concepts, and how do they relate?
2. **Articulate the thesis** — why does gwrk exist, and what bet does it make about the world?
3. **Ground the identity in shipped reality** — only claim what is built and working today.

---

## The Missing Piece: Ontology as Bridge

ADR-009 establishes that projects MAY declare three knowledge layers (domain ontology, information hierarchy, UX posture) and inject them into agent prompts. But gwrk itself has never performed ontology construction on its own domain. The result: the "What is gwrk?" document is concept mush — mixing tooling (CLI commands), methodology (Foxtrot Charlie), metrics (compression), personas (DUT/ZFG), and philosophy (the PE thesis) without distinguishing what kind of thing each one is.

Ontology is the technical bridge between:
- **JTBD / Discovery** (Pillar 1) — what progress is the PE trying to make?
- **Value / Delivery** (Pillar 4) — how do we know gwrk delivered it?

Without an ontology, you can't articulate the connection. You end up describing features instead of progress. The rewrite must make this connection explicit.

---

## Methodology: Five-Primitive Ontology Construction

Using the methodology from [ontology-construction-prompt.hbs](../R007-project-perspective/references/ontology-construction-prompt.hbs) and the compound reasoning skill [specify-sharpen](../../archive/reference/reasoning-skills.md), applied to gwrk itself:

### Pass 1: Extract Classes (What kinds of things exist in gwrk?)

Not features. Not commands. Kinds of things.

| Class | Definition | Boundary Test | Individuals |
|-------|-----------|---------------|-------------|
| **Initiative** | A unit of work with a lifecycle: discovered → defined → shipped → delivered | Not a Task (tasks are decompositions of initiatives). Not a Feature (features are implementation-scoped). | F014 Plugin System, R008 Ontology & Identity, a JTBD research brief |
| **Commitment** | A written artifact that binds execution — spec, plan, tasks, gate | Not a conversation. Not a narrative. Must be machine-readable enough to gate. | `spec.md`, `plan.md`, `tasks.json`, `T025-gate.sh` |
| **Agent** | An ephemeral executor that receives a task and produces a diff | Not gwrk (gwrk orchestrates, agents implement). Not a backend (Gemini/Claude are backends, agents are instances). | A ship-loop implement run, a code review pass, a define-tests generation |
| **Judgment** | A human decision that shapes what gets built, how it's decomposed, and what "done" means | Not automatable. Not delegable. The scarce resource the thesis names. | "This feature should have 4 phases", "The gate should check for X", "This spec needs a domain boundary section" |
| **Signal** | Measured evidence of progress or regression | Not opinion. Not narrative. Must be computable from artifacts. | Compression ratio, gate pass/fail, test count, LOC delta, convergence indicator |
| **Methodology** | A repeatable intellectual process with inputs, passes, and outputs | Not a tool. Not a command. A way of thinking that a tool can assist. | JTBD discovery, ontology construction, specify-sharpen, architecture-stress-test |

### Pass 2: Extract Relations

| Relation | Domain → Range | Cardinality | What It Means |
|----------|---------------|-------------|---------------|
| decomposes-into | Initiative → Commitment | 1:N | An initiative produces commitments (spec → plan → tasks) |
| gates | Commitment → Agent | 1:N | Commitments constrain what agents are allowed to do |
| produces | Agent → Signal | 1:N | Agent work produces measurable signals |
| informs | Signal → Judgment | N:1 | Signals inform (but don't replace) human judgment |
| shapes | Judgment → Initiative | 1:N | Judgment determines what initiatives exist and how they're scoped |
| applies | Methodology → Initiative | N:N | Methodologies are applied to initiatives (JTBD to discovery, ontology to definition) |

### Pass 3: Extract Axioms

| ID | Rule | What It Prevents |
|----|------|-----------------|
| AX-001 | An Agent never creates an Initiative | Scope creep. Agents implement; humans decide what to build. |
| AX-002 | A Commitment must precede Agent work | Cowboy coding. No spec, no ship. |
| AX-003 | A Signal is never a Judgment | Metric worship. Compression ratio is evidence, not a decision. |
| AX-004 | Judgment cannot be delegated to an Agent | Automation theater. The thesis: judgment is the scarce resource. |
| AX-005 | Every Initiative must produce at least one Signal | Accountability. Shipped ≠ delivered; signals close the loop. |
| AX-006 | A Methodology is not a Tool | Tool worship. gwrk is the tool; ontology construction is the methodology. |

---

## Discovery: The Three Answers to "What is gwrk?"

From the ontology, three distinct framings emerge. The rewrite must layer them:

### Answer 1: The Thesis (for the PE who hasn't heard of gwrk)

> The scarce resource in AI-assisted engineering isn't code generation — it's architectural judgment. gwrk is the operating system that lets a Principal Engineer turn judgment into shipped code at previously impossible speed, then measure whether it worked.

This is the "why should I care" answer. It names the bet.

### Answer 2: The Ontology (for the PE who wants to understand the model)

gwrk has six primitive concepts: **Initiatives**, **Commitments**, **Agents**, **Judgments**, **Signals**, and **Methodologies**. The system's job is to connect them in a loop:

```
Judgment → Initiative → Commitment → Agent → Signal → Judgment
```

This is Foxtrot Charlie expressed as a data flow, not a philosophy deck. Truth (judgment) becomes clarity (commitments) becomes throughput (agents) becomes value (signals) becomes new truth.

### Answer 3: The CLI (for the PE who wants to use it right now)

| What You Do | Command | What Happens |
|------------|---------|-------------|
| Turn an idea into a commitment | `gwrk define spec → plan → tests → tasks` | Strict pipeline: each step gates the next |
| Ship the commitment autonomously | `gwrk ship <feature> <phase>` | Implement → build → test → review → PR → merge loop |
| Measure whether it worked | `gwrk measure compression` | LOC-derived effort forecast vs. actual delivery time |
| Research a problem domain | `gwrk define research R00X` | Scaffold, methodology, structured discovery |

---

## Conclusion: What the Rewrite Must Be

The rewrite is **not** a brochure. It is the ontological identity of gwrk rendered as prose.

**Structure:**
1. The thesis (3 sentences)
2. The ontology (6 classes, their relations, the loop)
3. Foxtrot Charlie as the operating model (4 pillars mapped to CLI, not personas)
4. The compression flywheel (real data, the motivation metric)
5. What's shipped vs. what's planned (honest, no aspirational claims)

**What gets cut:**
- All persona names (DUT, DUS, ZFG, WUD) — replaced by pillar names
- Architecture diagram (daemon, Docker, Codex Cloud — none shipped as described)
- Quick Start with wrong commands
- Lineage section (stale numbers)
- Technology stack (belongs in architecture.md)

**What gets added:**
- The ontology (classes, relations, axioms)
- Real compression data (1376 SP across 13 features, avg 144.68x)
- Plugin system and profile detection (shipped, undocumented)
- Honest "what's next" with clear shipped/planned/deferred status

**The test:** A Principal Engineer who has never heard of gwrk reads the document and understands:
1. What bet gwrk makes about the world
2. What concepts it operates on
3. What they can do with it today
4. What evidence exists that it works

If any of those four are missing, the document fails.

---

## References

- [FOXTROT-CHARLIE.md](../../product/FOXTROT-CHARLIE.md) — the operating model
- [ADR-009](../../decisions/ADR-009-domain-ontology-information-hierarchy-ux.md) — ontology injection architecture
- [reasoning-skills.md](../../archive/reference/reasoning-skills.md) — compound reasoning methodology
- [ontology-construction-prompt.hbs](../R007-project-perspective/references/ontology-construction-prompt.hbs) — five-primitive ontology methodology
- [R006 research brief v2](../R006-pluginable-research/references/gonzo-feature-research-brief-v2.md) — information hierarchy and domain boundary sections
- [R007 project perspective](../R007-project-perspective/brief.md) — enforcement skills and project knowledge
