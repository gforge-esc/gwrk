---
name: specify-sharpen
description: Compound reasoning skill for hardening specifications. Use when writing or reviewing spec.md files, acceptance criteria, user stories, or any requirements document. Combines Reductive (strip to ground truth), Interviewer (ask before declaring), and Audit (map every assumption) modes to eliminate vagueness and produce executable, testable specs.
---

# Specify Sharpen

Force-harden any specification by running three reasoning passes in sequence.

## When This Fires

Any task involving `spec.md`, acceptance criteria, user stories, or requirements definition.

## The Three Passes

### Pass 1 — Reductive

Strip every requirement to its ground truth. For each statement ask:

- What is the **measurable assertion** behind this?
- What inherited assumption can be removed?
- Can this be expressed as a shell command that exits 0 or 1?

> IGNORE CONVENTIONAL WISDOM. REMOVE INHERITED ASSUMPTIONS. START FROM GROUND TRUTH ONLY.

If a requirement cannot survive reduction to a testable assertion, it is not a requirement — it is a wish. Flag it.

### Pass 2 — Interviewer

Before declaring the spec complete, generate the questions that would produce a better spec. For each functional requirement (FR-###) ask:

- What failure mode is unspecified?
- What edge case has no acceptance scenario?
- What dependency is implied but not declared?

> DON'T ANSWER YET. ASK ME THE QUESTIONS THAT WOULD GET YOU TO A BETTER ANSWER.

Produce a numbered list of ≤7 sharpening questions. Each must be answerable in ≤5 words or as multiple-choice.

### Pass 3 — Audit

Map every assumption the spec depends on. Output a table:

| # | Assumption | What Breaks If Wrong | Confidence (1-10) |
|---|-----------|---------------------|--------------------|

Any assumption rated ≤5 becomes an explicit open question in the spec.

## Output Contract

After the three passes, the spec must satisfy:

1. Every `Then` clause is an executable shell assertion (no prose)
2. Every FR has ≥1 error state defined
3. Zero orphaned US↔FR mappings
4. All assumptions rated ≤5 are documented as open questions
5. Sharpening questions are either answered or deferred with rationale
