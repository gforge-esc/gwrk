---
name: audience-model
description: Compound reasoning skill for understanding and modeling target audiences. Use when defining user personas, planning content strategy, preparing for demos, writing copy, designing onboarding, or any work that requires predicting how a specific audience will respond. Combines Modeling (simulate audience response), Interviewer (surface what you don't know about them), and Forensic (work backward from what they actually do, not what they say) modes.
---

# Audience Model

Build a working model of your target audience that predicts response — not just describes demographics.

## When This Fires

Defining user personas, planning content strategy, preparing demo narratives, writing copy that must resonate, designing onboarding flows, or any situation where you need to predict "will they care?"

## Why This Exists

The failure mode in audience work is **projection** — assuming the audience cares about what excites you. gwrk's builder is excited about multi-agent tandem dispatch, compression ratios, and Foxtrot Charlie governance. The target audience — a Principal Engineer drowning in context-switching — doesn't care about any of that until they care about the **problem** it solves.

The second failure mode is **abstraction** — targeting "developers" or "architects" instead of a specific person with a specific Friday afternoon.

## The Three Passes

### Pass 1 — Modeling

Simulate how a specific person in the target audience responds to the message, feature, or content:

- **Pick one person** (real or composite). Give them a name, a stack, a frustration, and a Friday.
- **Simulate their day**: What tool are they in right now? What just interrupted them? What are they annoyed about?
- **Run your message through their filter**: Do they read past the first sentence? Do they click? Do they share? Do they try it?

> SIMULATE HOW [THIS SPECIFIC PERSON] WOULD RESPOND TO THIS. BE SPECIFIC.

If you can't simulate them clicking, the message isn't ready.

### Pass 2 — Interviewer

Surface what you don't actually know about the audience:

- What assumption about them are you most likely wrong about?
- What question would you ask them if you had 60 seconds?
- What do they do TODAY to solve the problem you're addressing? (Not "nothing" — they're doing *something*.)
- What word would THEY use to describe their problem?

> DON'T ANSWER YET. ASK ME THE QUESTIONS THAT WOULD GET YOU TO A BETTER ANSWER.

Produce ≤5 audience insight questions. Each should be investigable (not theoretical).

### Pass 3 — Forensic

Work backward from what the audience actually does (behavior) not what they say (stated preference):

- What tools do they use daily? (Look at their terminal, not their LinkedIn.)
- What do they star/bookmark/share on GitHub/Twitter/HN?
- What content formats do they actually consume? (Long blog? Thread? README? Demo video?)
- When have they adopted a new tool recently? What triggered the switch?

> WORK BACKWARD FROM THEIR BEHAVIOR. WHAT THEY DO IS THE EVIDENCE. WHAT THEY SAY IS THE NOISE.

## Output Contract

```markdown
## Audience Model: [persona name]

### Identity
- Role: [title]
- Stack: [languages, tools, platforms]
- Frustration: [the thing that ruins their Friday]
- Current workaround: [what they do today]

### Behavioral Evidence
- Tools they actually use: [list]
- Content they actually consume: [formats, platforms]
- Last new tool they adopted: [tool] — triggered by [event]

### Simulation
Message/feature: [what we're testing]
Response prediction: [read / ignore / click / try / share / buy]
Key friction point: [what almost stops them]
Key hook: [what tips them over]

### Insight Gaps
1. [what we don't know] → [how to find out]

### Voice Calibration
- Words THEY use: [their vocabulary]
- Words to AVOID: [your vocabulary they'd reject]
```
