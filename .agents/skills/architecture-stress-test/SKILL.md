---
name: architecture-stress-test
description: Compound reasoning skill for validating architectural plans before implementation. Use when reviewing plan.md files, evaluating phase designs, assessing dependency ordering, sizing phases, or checking cross-spec compatibility. Combines Analytical (decompose structure), Pre-mortem (assume failure and trace causes), and Comparative (evaluate against alternatives) modes.
---

# Architecture Stress Test

Validate an architectural plan by decomposing, killing, and comparing it.

## When This Fires

Reviewing `plan.md`, evaluating phase designs, assessing phase sizing, dependency ordering, or cross-spec compatibility.

## The Three Passes

### Pass 1 — Analytical

Decompose the plan into its structural components:

- What are the dependency edges? Draw them.
- Which phases can run in parallel? Which are strictly serial?
- Where is the critical path? What is its length?
- What is the blast radius if phase N fails?

> BREAK DOWN TO ITS CORE STRUCTURE. WHAT ARE THE COMPONENTS AND HOW DO THEY RELATE?

Produce a dependency table:

| Phase | Depends On | Produces | Blast Radius If Late |
|-------|-----------|----------|---------------------|

### Pass 2 — Pre-mortem

Assume this plan failed 6 months from now. Trace backward:

- Which phase was the bottleneck?
- Which contract was violated first?
- Which assumption turned out to be wrong?
- What did we miss because we didn't cross-reference?

> THIS FAILED 6 MONTHS FROM NOW. WHAT WERE THE MOST LIKELY CAUSES?

Produce ≤5 failure scenarios ranked by likelihood.

### Pass 3 — Comparative

Evaluate the plan against its alternatives (not in isolation):

- What is the simplest plan that satisfies the same spec?
- What is the most parallel plan (fastest wall-clock)?
- What is the most conservative plan (lowest risk)?
- Where does the proposed plan sit on the speed↔safety spectrum?

> DON'T EVALUATE THIS ALONE. COMPARE IT AGAINST THE 3 MOST VIABLE ALTERNATIVES.

## Output Contract

```markdown
## Plan Assessment: [feature]

### Structure
[dependency table]

### Pre-mortem Scenarios
1. [scenario] — likelihood: [H/M/L] — mitigation: [action]

### Alternatives Considered
| Plan | Speed | Risk | Complexity | Why Not Chosen |
|------|-------|------|-----------|---------------|

### Verdict
[APPROVE / REVISE with specific changes]
```
