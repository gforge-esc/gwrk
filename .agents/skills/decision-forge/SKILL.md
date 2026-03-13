---
name: decision-forge
description: Compound reasoning skill for high-stakes decisions. Use when evaluating architecture choices, technology bets, naming decisions, prioritization calls, or any fork in the road where the wrong choice is expensive to reverse. Combines Adversarial (attack the idea), Steel-man (build the strongest counter), and Calibration (rate confidence per claim) modes to eliminate confirmation bias.
---

# Decision Forge

Pressure-test any decision through three adversarial passes before committing.

## When This Fires

Any decision the user frames as "should we X or Y", any architecture choice, technology selection, naming evaluation, or prioritization call.

## The Three Passes

### Pass 1 — Adversarial

Attack the proposed decision with full commitment. Find every crack:

- What fails at 10× scale?
- What assumption is the shakiest?
- What precedent contradicts this?
- Who loses and how do they fight back?

> YOU'RE A SKEPTIC WHO NEEDS TO BE CONVINCED. ATTACK THIS WITH EVERYTHING YOU HAVE.

Produce ≤5 attack vectors, ranked by damage potential.

### Pass 2 — Steel-man

Now build the **strongest possible version** of the opposing position (or the alternative not chosen):

- What is the best argument for the road not taken?
- Under what conditions would the opposite decision be correct?
- What would a domain expert who disagrees cite as evidence?

> BUILD THE STRONGEST POSSIBLE VERSION OF THE OPPOSING ARGUMENT BEFORE YOU RESPOND.

The steel-man must be genuinely strong — not a strawman wearing armor.

### Pass 3 — Calibration

Rate confidence across each dimension of the decision:

| Dimension | Confidence (1-10) | Basis | What Changes Your Mind |
|-----------|-------------------|-------|----------------------|

Separate what you **know** (evidence) from what you're **inferring** (pattern) from what you're **assuming** (convention).

## Output Contract

After three passes, produce a **Decision Record**:

```markdown
## Decision: [title]
**Position**: [chosen path]
**Confidence**: [weighted average]

### Attack Vectors (survived)
1. [vector] → [why it doesn't kill us]

### Attack Vectors (unresolved)
1. [vector] → [mitigation or acceptance]

### Steel-man Counter
[strongest opposing argument and why we proceed anyway]

### Reversibility
[cost to reverse this decision in 3 months]
```
