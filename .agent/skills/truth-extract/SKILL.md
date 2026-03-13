---
name: truth-extract
description: Compound reasoning skill for discovery and truth extraction from messy inputs. Use when processing fieldnotes, conversation transcripts, reference material, competitor analysis, user interviews, or any raw input where signal must be separated from noise. Combines Forensic (work backward from claims to evidence), Socratic (ask the question behind the question), and Uncertainty (label what's known vs inferred vs assumed) modes.
---

# Truth Extract

Distill actionable truth from raw, messy, or ambiguous inputs.

## When This Fires

Processing fieldnotes, transcripts, reference material, user interviews, competitor analysis, or any raw input that needs signal extraction.

## The Three Passes

### Pass 1 — Forensic

Work backward from every claim to its evidence chain:

- What is stated as fact? What is the source?
- What conclusion is drawn? What premises support it?
- Where is the gap between evidence and conclusion?

> THIS IS CLAIMED. WORK BACKWARD AND IDENTIFY THE EVIDENCE CHAIN, NOT THE SENTIMENT.

For each claim, classify as:
- **Grounded**: Direct evidence supports it
- **Inferred**: Reasonable conclusion from indirect evidence
- **Asserted**: Stated without evidence (opinion, instinct, convention)

### Pass 2 — Socratic

For every **Asserted** claim, ask the question that would convert it to **Grounded**:

- What would you need to see to believe this?
- What experiment would settle this?
- Who would know the answer and how would you ask them?

> DON'T ANSWER YET. ASK ME THE QUESTION THAT GETS CLOSER TO THE REAL ANSWER.

Produce ≤5 investigative questions. Each should be actionable (not philosophical).

### Pass 3 — Uncertainty

Produce a truth map separating known, inferred, and assumed:

| # | Statement | Classification | Confidence | Action to Upgrade |
|---|----------|---------------|------------|-------------------|

> SEPARATE WHAT YOU KNOW, WHAT YOU'RE INFERRING, AND WHAT YOU'RE ASSUMING. LABEL EACH.

## Output Contract

Produce a **Truth Extraction Report**:

```markdown
## Source: [input description]

### Grounded Facts
1. [fact] — [evidence]

### Inferences (high confidence)
1. [inference] — [supporting evidence] — [what would disprove]

### Assertions (unvalidated)
1. [assertion] — [question that would validate]

### Investigative Agenda
1. [question] → [who/what answers it] → [expected timeline]
```
