---
name: position-lock
description: Compound reasoning skill for product positioning and messaging distillation. Use when crafting taglines, elevator pitches, competitive positioning, landing page headlines, one-liners, or any situation where a complex product must be compressed into a single clear position. Combines Reductive (strip to ground truth), Comparative (evaluate against alternatives), and Aesthetic (optimize for elegance) modes.
---

# Position Lock

Compress a complex product into a single defensible position that survives contact with competitors, skeptics, and short attention spans.

## When This Fires

Writing taglines, elevator pitches, positioning statements, landing page headlines, competitive comparisons, category definitions, or any context where "what is this?" must be answered in one breath.

## Why This Exists

gwrk is a CLI + build server + multi-agent orchestrator + Slack control plane + productivity dashboard + spec pipeline + effort estimator. Listing all of that kills the message. The failure mode is feature-listing instead of position-claiming.

The best positioning doesn't describe the product — it describes the **category shift** the product creates.

## The Three Passes

### Pass 1 — Reductive

Strip the product to its ground truth. Remove every feature, capability, and buzzword until only the irreducible thesis remains:

- What does this make **possible** that was previously **impossible**?
- If forced to keep only ONE capability, which one?
- What is the single sentence a user would tell a friend?
- What job does this do that nothing else does?

> IGNORE CONVENTIONAL WISDOM. REMOVE INHERITED ASSUMPTIONS. START FROM GROUND TRUTH ONLY.

Keep stripping until you hit the sentence that makes everything else a consequence.

### Pass 2 — Comparative

Evaluate the position against alternatives — never in isolation:

- **vs. the status quo**: What does the user do today? Why is it worse?
- **vs. the closest competitor**: What does Cursor/Copilot/Devin/OpenClaw claim? Where is the gap?
- **vs. the category**: Is this a better tool in an existing category, or a new category?

> DON'T EVALUATE THIS ALONE. COMPARE IT AGAINST THE 3 MOST VIABLE ALTERNATIVES.

The position must own territory that competitors can't claim without lying.

### Pass 3 — Aesthetic

Optimize the surviving position for elegance:

- **Compression**: Can it be said in ≤10 words?
- **Cadence**: Does it have rhythm? Read it aloud.
- **Memorability**: Will someone remember it tomorrow?
- **Duality**: Does it contain a tension that makes people think?
- **Provocation**: Does it make someone who disagrees want to argue?

> WHAT'S THE MOST BEAUTIFUL VERSION OF THIS? OPTIMIZE FOR ELEGANCE OVER EFFICIENCY.

Score each candidate position on these dimensions. The winner is the one that's both true and sticky.

## Output Contract

```markdown
## Position Lock: [product/feature]

### Ground Truth (one sentence)
[irreducible thesis]

### Position Statement
For [audience] who [situation],
[product] is the [category]
that [key differentiator],
unlike [alternative] which [limitation].

### Competitive Territory Map
| Claim | gwrk | Competitor A | Competitor B |
|-------|------|-------------|-------------|
| [claim] | ✅ Owns | ❌ Can't | ⚠️ Partial |

### Headline Candidates
1. [≤10 words] — score: [1-10]
2. [≤10 words] — score: [1-10]
3. [≤10 words] — score: [1-10]

### Recommended Position
[final pick] — [one-sentence justification]
```
