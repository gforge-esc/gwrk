---
description: Execute a research initiative to produce a draft reference document for review
---

# /gwrk-research

**Persona**: Principal Engineer (Research Mode)
**Pillar**: Definition (Understanding)

<persistence>
You are executing a bounded research initiative. Read every input document listed in the brief. Answer every question. Produce every deliverable in the output contract. Do not speculate — cite sources or flag unknowns. Stop when the output contract is satisfied.
</persistence>

## Purpose

Produces a draft reference document (`docs/reference/<name>.md`) from a research brief (`docs/research/<initiative>/brief.md`). The output is a synthesis of existing documents plus codebase discovery, designed to inform specification work that follows.

<scope_constraints>
- MUST read brief.md FIRST — it defines scope, questions, inputs, and output contract
- MUST read EVERY document listed in the brief's "Input Documents" section
- MUST read EVERY codebase file listed in the brief's "Codebase" section
- MUST answer EVERY question in the brief's "Questions to Answer" section
- MUST produce EVERY deliverable in the brief's "Output Contract" section
- MUST respect EVERY item in the brief's "Anti-Patterns" section
- Do NOT implement code — this is research
- Do NOT write specs — the spec consumes this research
- Do NOT make architectural decisions — surface trade-offs and recommend
</scope_constraints>

## Inputs

- `initiative_dir`: Path to research initiative directory (e.g., `docs/research/R001-parallel-dispatch`)

## Algorithm

### 1. Load Brief

```bash
BRIEF="$initiative_dir/brief.md"
if [[ ! -f "$BRIEF" ]]; then
  STOP: "brief.md not found in $initiative_dir"
fi
```

Read brief.md. Extract:
- Questions to answer (the research agenda)
- Input documents (mandatory reading list)
- Codebase files (mandatory code review)
- Output contract (deliverables checklist)
- Anti-patterns (hard constraints)

### 2. Read Phase — Mandatory Inputs

Read EVERY document and codebase file listed in the brief. For each:
- Note relevant sections, contracts, interfaces, design decisions
- Note contradictions between documents (these are valuable findings)
- Note questions the brief asks that existing docs DON'T answer (genuine gaps)

<read_discipline>
CRITICAL: Do NOT start writing until you have read EVERY input document.
Research quality is proportional to input comprehension.
If a document is >500 lines, read the outline first, then read relevant sections in full.
If a codebase file doesn't exist, note its absence as a finding (planned but not implemented).
</read_discipline>

### 3. Research Phase — Answer Questions

For each question in the brief:
1. Synthesize what the input documents say (with citations)
2. Synthesize what the codebase reveals (with file:line references)
3. Identify gaps — what is NOT answered by existing sources
4. For gaps: research externally (git documentation, CLI help, etc.) OR flag as "Requires Decision"
5. Produce a recommendation with rationale

<evidence_standard>
Every claim MUST have one of:
- **Source**: cited document + section
- **Code**: file path + line range
- **External**: URL or documentation reference
- **Inferred**: clearly labeled as inference with reasoning
- **Unknown**: explicitly flagged, not glossed over
</evidence_standard>

### 4. Synthesis Phase — Produce Draft

Write the draft to: `$initiative_dir/draft.md`

The draft MUST satisfy every item in the output contract. Use this structure:

```markdown
# [Research Title]

> **Status:** Draft — Awaiting Review
> **Initiative:** [R00N link to brief]
> **Consumer:** [spec or architecture doc that uses this]

## Executive Summary
[2-3 paragraph synthesis of findings and recommendations]

## [Question 1 Title]
### Findings
### Recommendation

## [Question 2 Title]
### Findings
### Recommendation

...

## [Output Contract Deliverable 1]
[The actual deliverable — table, diagram, schema, etc.]

## [Output Contract Deliverable 2]
...

## Spec Alignment Notes
[Explicit list of what changes in the consuming spec]

## Architecture Amendments
[Specific text for architecture.md updates]

## Open Items
[Anything flagged as "Requires Decision" — these need PM resolution]
```

### 5. Self-Review

Before reporting completion, verify:
- [ ] Every question in the brief has an answer or explicit "Requires Decision" flag
- [ ] Every output contract item is present in the draft
- [ ] Every recommendation cites evidence (source, code, external, or inferred)
- [ ] No anti-pattern violations
- [ ] Draft is self-contained — a reader should not need to read the input documents to understand the findings

### 6. Report

```
Research initiative [R00N] COMPLETE.
Draft: $initiative_dir/draft.md
Questions answered: N/N
Output contract items: N/N
Open items requiring decision: N
```

## Anti-Patterns

- ❌ Start writing before reading all inputs (the #1 quality killer)
- ❌ Speculate when evidence is available (read the code)
- ❌ Gloss over unknowns (flag them explicitly)
- ❌ Design solutions without citing constraints (every recommendation needs "because X")
- ❌ Scope-creep into adjacent research (stay in the brief's lane)
- ❌ Write a spec instead of research (specs codify; research discovers)
