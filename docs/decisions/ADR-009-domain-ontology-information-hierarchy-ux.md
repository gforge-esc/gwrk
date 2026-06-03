# ADR-009: Domain Ontology, Information Hierarchy, and UX as Project Knowledge

> **Status:** Decided · **Date:** 2026-06-02
> **Decision:** Projects MAY declare three layers of knowledge that gwrk injects into agent prompts: domain ontology (what things mean), information hierarchy (what matters first), and UX posture (how actors experience the system). These are project-owned documents, not gwrk builtins.
> **Depends on:** F014 (Plugin System), ADR-007 (Single Dispatch Path), ADR-008 (Command Safety Posture)
> **Author:** David Gonzalez · **Decision Scope:** Agent grounding, prompt context, project perspective

---

## 1. Context

### The Concept Mush Problem

Agents working on a project produce better output when they understand the project's domain vocabulary, priority structure, and user experience posture. Without this grounding:

- **Synonym collision**: The agent uses "assessment" and "survey" interchangeably when they are distinct domain concepts with different lifecycle rules. Observed in Skills Connection where "guidance" meant four different things across features — survey guidance, TSC guidance, generated guidance, best-practice-answer guidance ([ontology-construction-prompt.hbs L401-404](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L401-L404)).
- **Priority inversion**: The agent presents recovery states before primary states. A CLI that reports error details before the summary. A dashboard that shows metadata before the decision it supports.
- **UX blindness**: The agent builds a technically correct feature that ignores how the actor experiences the output — no consideration of trust, evidence provenance, or recovery from wrong system state.

### Three Lenses, Not One

These are distinct concerns that the [Gonzo Feature Research Brief v2](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md) separates into independent sections for a reason:

| Lens | Brief Section | What It Answers | What Failure Looks Like |
|---|---|---|---|
| **Domain Ontology** | [Section 5: Domain Boundary](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L283-L315), [Pack C](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L428-L483) | What do things mean? What must the system not confuse? | Agent conflates concepts. Code uses wrong names. Specs have invisible ambiguity. |
| **Information Hierarchy** | [Section 4: Information Hierarchy](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L230-L280) | What must be seen first? How is uncertainty expressed? What happens when the system is wrong? | Agent buries the decision in detail. No confidence expression. No recovery path. |
| **UX Posture** | [Section 4: UX Journey Sketch](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L259-L267) | How does the actor move through entry → orientation → judgment → action → closure? | Agent builds feature without considering trust, failure, or the actor's real question at each moment. |

### The Ontology Construction Prompt as Evidence

The [ontology-construction-prompt.hbs](../research/R007-project-perspective/references/ontology-construction-prompt.hbs) demonstrates what a domain ontology looks like in practice. It defines five primitives from formal knowledge engineering:

1. **Classes** — kinds of things, not instances. Valid only if you can point to two distinguishable instances. ([L309-312](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L309-L312))
2. **Properties** — identifier (immutable), intrinsic (low volatility), state (medium), derived (computed), extrinsic (context-dependent). ([L314-316](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L314-L316))
3. **Relations** — typed edges with cardinality, direction, required/optional. ([L318-320](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L318-L320))
4. **Individuals** — 3-5 concrete instances per class that validate the model. If an instance doesn't fit, the model is wrong. ([L322-325](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L322-L325))
5. **Axioms** — what must always be true, what can never be true. Types: disjointness, existential, universal, cardinality, conditional. ([L327-329](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L327-L329))

And seven failure modes to check against ([L383-414](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L383-L414)):
- Overloading (one class doing three jobs)
- Undergeneralizing (ten concepts that are really one with a type property)
- Missing middle (a relation that should be a class)
- Assumption burial (a rule in someone's head instead of the model)
- Synonym collision (same word, different meaning)
- Instance/class confusion (concrete example modeled as a kind)

### The Information Hierarchy as Decision Architecture

The information hierarchy is not a UI layout. It is the priority structure that any surface — dashboard, CLI, API, Slack message, generated report, spreadsheet — must respect:

| Level | Name | Actor Question |
|---:|---|---|
| 0 | **Decision** | What exact decision does this capability support? |
| 1 | **Primary State** | What is the most important thing I must see first? |
| 2 | **Evidence / Confidence** | How do I know whether to trust this? |
| 3 | **Action / Control** | What can I do next? |
| 4 | **Recovery** | What happens when this is wrong, stale, or uncertain? |

This hierarchy is *not* optional in the Gonzo Brief — it is a core section (not a pack). Every capability has a user experience, even if the surface is a database row visible through downstream systems.

### What UX Means Here (Not UI)

UX is not wireframes. UX is the actor's journey through five moments:

| Moment | Actor Question |
|---|---|
| Entry | "Why am I here?" |
| Orientation | "What am I looking at?" |
| Judgment | "Do I trust this?" |
| Action | "What do I do next?" |
| Closure | "Did this work?" |

An agent that understands these moments builds features that answer the right question at the right time. An agent without this posture builds technically correct features that the actor doesn't trust, can't navigate, or can't recover from.

---

## 2. Decision

### 2.1 Project Knowledge Documents

Projects MAY declare three knowledge documents in `.gwrk/`. All are optional. All are authored or refined by the project owner, not generated by gwrk.

```
.gwrk/
  ontology/
    domain.md         ← Domain ontology (Pack C format: classes, properties, relations, axioms, glossary)
  perspective/
    hierarchy.md      ← Information hierarchy (L0–L4 priority structure for this project)
    ux-posture.md     ← UX journey posture (entry → orientation → judgment → action → closure)
```

### 2.2 Document Formats

#### Domain Ontology (`.gwrk/ontology/domain.md`)

Uses the five-primitive structure from [ontology-construction-prompt.hbs L304-337](../research/R007-project-perspective/references/ontology-construction-prompt.hbs#L304-L337):

```markdown
# Domain Ontology: [Project Name]

## Classes
| Class | Definition | Boundary Test | Example Individuals |
|---|---|---|---|
| Assessment | Structured evaluation with verdict | Not a Survey (surveys collect data; assessments judge) | Q3 Risk Assessment, Annual Compliance Review |

## Properties
| Class | Property | Kind | Description | Constraint |
|---|---|---|---|---|
| Assessment | status | state | Lifecycle position | enum: draft, active, completed, archived |

## Relations
| Relation | Domain | Range | Cardinality | Required? |
|---|---|---|---|---|
| evaluates | Assessment | Subject | N:1 | Y |

## Axioms
| ID | Rule | What It Prevents |
|---|---|---|
| AX-001 | An Assessment is never a Survey | Concept mush |

## Glossary
| Term | Canonical Meaning | Must Not Be Confused With |
|---|---|---|
| Assessment | Evaluation with verdict | Survey (no verdict), Report (output not process) |
```

#### Information Hierarchy (`.gwrk/perspective/hierarchy.md`)

```markdown
# Information Hierarchy: [Project Name]

| Level | Name | This Project's Answer |
|---:|---|---|
| 0 | Decision | [What decisions does this system support?] |
| 1 | Primary State | [What must the actor see first?] |
| 2 | Evidence | [How does the actor know whether to trust it?] |
| 3 | Action | [What can the actor do next?] |
| 4 | Recovery | [What happens when the system is wrong?] |
```

#### UX Posture (`.gwrk/perspective/ux-posture.md`)

```markdown
# UX Posture: [Project Name]

| Moment | Actor Question | This Project's Answer |
|---|---|---|
| Entry | "Why am I here?" | [What triggers the actor to engage?] |
| Orientation | "What am I looking at?" | [How does the actor orient?] |
| Judgment | "Do I trust this?" | [What evidence builds trust?] |
| Action | "What do I do next?" | [What controls does the actor have?] |
| Closure | "Did this work?" | [How does the actor know it worked?] |
```

### 2.3 Injection Mechanism

These documents are injected as agent grounding context alongside enforcement skills. The injection point is `dispatchToAgent()` in [agent.ts](../../src/utils/agent.ts) — the same bottleneck that ADR-008 uses for command safety.

```
Agent prompt receives:
  1. {{enforcement}} — coding standards (existing, FR-014)
  2. <command_safety> — safety posture (existing, ADR-008)
  3. <domain_ontology> — if .gwrk/ontology/domain.md exists  [NEW]
  4. <information_hierarchy> — if .gwrk/perspective/hierarchy.md exists  [NEW]
  5. <ux_posture> — if .gwrk/perspective/ux-posture.md exists  [NEW]
```

Injection is file-based. If the file exists, read it and inject. If it doesn't, skip. Zero configuration.

### 2.4 Relationship to R006 (Pluginable Research)

Domain ontology construction is a research workflow: `gwrk define research "Domain Model" --methodology ontology` dispatches an agent that reads the codebase and existing docs, then produces `.gwrk/ontology/domain.md`. This is an R006 workflow plugin — gwrk ships the mechanism, the ontology-construction prompt is the methodology.

Information hierarchy and UX posture are authored as part of research briefs (Section 4 of the Gonzo Brief) and carried forward into the project as standing documents.

### 2.5 What This Is Not

- **Not a schema validator.** gwrk does not validate the format of these documents. They are grounding context, not structured data.
- **Not auto-generated.** gwrk does not scan a codebase and produce an ontology. An agent-assisted workflow (R006) can help, but the output is human-reviewed.
- **Not mandatory.** Projects work fine without any of these documents. Enforcement skills (FR-014) already handle "how we write code." These documents handle "what things mean" and "what matters first."
- **Not UI design.** Information hierarchy and UX posture are about priority structure and actor journey, not wireframes or CSS.

---

## 3. Impact Analysis

### 3.1 `agent.ts` — New Injection

After enforcement skill injection and command safety injection, add:

```typescript
// ADR-009: Inject domain ontology if present
const ontologyPath = path.join(workDir, ".gwrk/ontology/domain.md");
if (fs.existsSync(ontologyPath)) {
  const content = fs.readFileSync(ontologyPath, "utf-8");
  stdinParts.push(`<domain_ontology>\n${content}\n</domain_ontology>`);
}

// ADR-009: Inject information hierarchy if present
const hierarchyPath = path.join(workDir, ".gwrk/perspective/hierarchy.md");
if (fs.existsSync(hierarchyPath)) {
  const content = fs.readFileSync(hierarchyPath, "utf-8");
  stdinParts.push(`<information_hierarchy>\n${content}\n</information_hierarchy>`);
}

// ADR-009: Inject UX posture if present
const uxPath = path.join(workDir, ".gwrk/perspective/ux-posture.md");
if (fs.existsSync(uxPath)) {
  const content = fs.readFileSync(uxPath, "utf-8");
  stdinParts.push(`<ux_posture>\n${content}\n</ux_posture>`);
}
```

### 3.2 `init.ts` — Directory Scaffolding

`gwrk init` creates the directories (empty, zero-config):

```typescript
const dirs = [
  "specs",
  ".gwrk/rules",
  ".gwrk/ontology",        // ADR-009
  ".gwrk/perspective",     // ADR-009
];
```

### 3.3 No Spec Changes Required

These are project-owned documents read from disk. No manifest schema changes. No plugin loader changes. No new CLI commands. The injection is three `fs.existsSync` checks in `dispatchToAgent()`.

---

## 4. Decision Record

**Position:** Domain ontology, information hierarchy, and UX posture are three independent knowledge layers that projects can declare. They are injected as agent grounding context through the existing dispatch bottleneck. They are optional, file-based, and human-authored.

**Confidence:** 8/10

**Key rationale:** The ontology construction prompt demonstrates that formal domain modeling produces measurably better agent output — the Skills Connection ontology eliminated synonym collision across six experimental features. The information hierarchy prevents priority inversion in every surface the system produces. UX posture ensures agents build features that respect the actor's journey, not just technical correctness.

**Reversibility:** Full. These are files on disk and string concatenation in `dispatchToAgent()`. Removing the injection is deleting three `if` blocks.

**Risk:** Over-long prompts. If a project has a large ontology, information hierarchy, and UX posture, the combined injection could be several thousand tokens. Mitigation: these are human-authored documents — the author controls length. The prompt conditioner could add a size warning if total injection exceeds a threshold.

---

## 5. References

- [Gonzo Feature Research Brief v2 — Section 4: Information Hierarchy](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L230-L280) — the five-level hierarchy (Decision → State → Evidence → Action → Recovery)
- [Gonzo Feature Research Brief v2 — Section 5: Domain Boundary](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L283-L315) — concept boundary and candidate domain objects
- [Gonzo Feature Research Brief v2 — Pack C: Domain Ontology](../research/R006-pluginable-research/references/gonzo-feature-research-brief-v2.md#L428-L483) — five primitives (classes, properties, relations, individuals, axioms)
- [Ontology Construction Prompt](../research/R007-project-perspective/references/ontology-construction-prompt.hbs) — real-world ontology construction for Skills Connection. Demonstrates the five-primitive methodology, seven failure modes, and the reference-not-instructions principle.
- ADR-007: Single Dispatch Path — establishes `dispatchToAgent()` as the prompt injection bottleneck.
- ADR-008: Command Safety Posture — precedent for file-based prompt injection at dispatch time.
- R006: Pluginable Research — `--methodology ontology` workflow for agent-assisted ontology construction.
