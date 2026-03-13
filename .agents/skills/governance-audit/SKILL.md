---
name: governance-audit
description: Compound reasoning skill for cross-artifact consistency and governance validation. Use when running /analyze, reviewing cross-spec compatibility, checking contract alignment, validating constitution compliance, or detecting drift between spec→plan→tasks→code. Combines Audit (systematic assumption mapping), Comparative (evaluate against the standard, not in isolation), and Integrative (unify findings into a single coherent assessment) modes.
---

# Governance Audit

Systematic consistency check across definition artifacts using three lenses.

## When This Fires

Running `/analyze`, cross-spec review, contract compatibility checks, constitution compliance, or any situation where multiple artifacts must agree.

## The Three Passes

### Pass 1 — Audit

Map every dependency and assumption across the artifact chain:

For each artifact pair (spec↔plan, plan↔tasks, spec↔contracts):
- What does artifact A promise that artifact B must deliver?
- What ID appears in A but not in B (orphan)?
- What ID appears in B but not in A (ghost)?
- What term is used differently across artifacts (drift)?

> LIST EVERY ASSUMPTION THIS DEPENDS ON. FOR EACH ONE, WHAT BREAKS IF IT'S WRONG?

Produce a traceability matrix:

| Requirement | In Spec | In Plan | In Tasks | In Contracts | In Gates | Status |
|------------|---------|---------|----------|-------------|----------|--------|

### Pass 2 — Comparative

Don't evaluate each artifact alone — compare against the governance standard:

- Does `plan.md` satisfy every rule in `/plan` workflow's quality gate?
- Does `spec.md` satisfy every rule in `/specify` workflow's quality gate?
- Do gate scripts derive assertions from `contracts/`, not from task prose?
- Does the phase sizing violate the ≤10 files/phase rule?

> DON'T EVALUATE THIS ALONE. COMPARE IT AGAINST THE 3 MOST VIABLE ALTERNATIVES.

For each violation, cite the exact governance rule being broken.

### Pass 3 — Integrative

Synthesize all findings into a single coherent assessment:

- What is the **one thing** most likely to cause implementation failure?
- What is the overall readiness state (READY / NOT READY)?
- What is the minimum set of changes to reach READY?

> SYNTHESIZE EVERYTHING WE'VE COVERED INTO A SINGLE COHERENT FRAMEWORK. NO REDUNDANCY.

## Output Contract

```markdown
## Governance Audit: [feature]

### Traceability Matrix
[matrix from Pass 1]

### Governance Violations
| # | Rule | Location | Severity | Fix |
|---|------|----------|----------|-----|

### Critical Path to READY
1. [highest-impact fix]
2. [next fix]
3. [next fix]

### Verdict: [READY / NOT READY]
```
