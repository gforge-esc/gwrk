# Ship Loop Architecture: The Why-Nix Lens

**Date**: 2026-03-12 | **Status**: Thinking — not a spec yet

---

## The Core Insight (from the Manus post)

Unix and LLMs made the same design decision 50 years apart: **everything is text**. CLI is the densest tool-use pattern in LLM training data. The agent already knows it. So instead of inventing a new tool interface, give the agent the one it was born knowing.

Applied to gwrk: **gwrk should be the agent's tool interface, not just its orchestrator.**

---

## The Problem with the Current Ship Loop

WUD currently receives a document drop (spec.md + plan.md + tasks.json) and runs in a cloned repo with full shell access. That's powerful but unguided — no discovery layer, no structured error feedback, no consistent output format.

The agent figures out everything from context. That's fine for a talented LLM in a controlled repo. It doesn't scale to polyglot work types (design, editorial, research) or to routing decisions between backends.

---

## What Changes If WUD Runs gwrk Commands

Instead of "agent in a directory doing whatever," WUD executes a sequence of gwrk primitives:

```bash
gwrk tasks next 004-ship-loop phase-01    # discovers what to build — structured output
gwrk gate-check T003                      # runs gate, returns exit:0/1 + duration
gwrk test 004-ship-loop --phase 01        # scoped vitest, clean exit code
gwrk tasks done 004-ship-loop T003        # marks done, gate enforced, state updated
```

This is the single-`run` pattern: unified interface, consistent output format (`[exit:0 | 1.2s]`), progressive discovery. The agent isn't figuring out which test files to run — `gwrk test` tells it. The agent isn't guessing at state — `gwrk tasks next` tells it.

**The router can dispatch any backend** (Codex, Claude, Gemini, o1) to any task because the interface is stable. The backend doesn't need to know the project's test stack — it runs gwrk commands and reads structured output.

---

## The Three Architectural Questions for 004

### 1. Is WUD a CLI consumer or a script runner?

- **Script runner** (current): WUD runs `work-until-done.sh`, does whatever it wants inside the repo. Loop intelligence lives in the script.
- **CLI consumer**: WUD runs `gwrk` commands. Loop intelligence lives in gwrk. Structured output, programmatically observable, routeable.

**This is the foundational choice for 004.**

### 2. What does a "phase" mean across work types?

Code phases → git branches + test files. Natural.
Design phases → Figma component? v0 prompt? Storybook story?
Editorial phases → draft revision? chapter review?

The phase abstraction must be general enough that the router dispatches any work type through the same loop. The gate is the variable — the phase shape is constant.

### 3. What's the gate for non-code work?

| Work type | Gate authority |
|---|---|
| TypeScript | `pnpm vitest run` — authoritative, binary |
| Design | Visual regression / screenshot diff — needs tooling |
| Research article | `gwrk review` with structured rubric — score against criteria |
| Book chapter | Editorial checklist — structured pass/fail per criterion |

Vitest answers "did it compile and behave?" A review rubric answers "does this meet quality criteria?" Both exit 0/1 with structured stderr. The gate interface is the same; the judge changes.

---

## Project Templates as "Build Profiles"

A project template = `skills/` + `rules/` + a gate definition per deliverable type.

| Template | Ship atom | Gate type | Review persona |
|---|---|---|---|
| TypeScript webapp | PR merged + CI | `pnpm vitest` + `pnpm build` | Code review |
| Frontend design | Component export | Screenshot diff or v0 approval | Design review |
| Research article | Markdown draft | Rubric score >= threshold | Editorial review |
| Book chapter | Revised draft | Structured editorial checklist | Author review |

The four Foxtrot Charlie pillars are constant. The build profile — skills, gates, review persona — is the variable. gwrk ships all of them through the same loop.

This is already partially the model: `.agent/rules/` + `.agent/workflows/` are the seed of a build profile. The missing piece: making the gate and review layer pluggable per project type.

---

## Open Questions (for next session)

1. How does gwrk express "project type" in `.gwrkrc.json`? A `buildProfile` field? A `skills` array?
2. What's the v1 scope for 004? CLI consumer model or keep script runner and evolve?
3. Can the router (008) make routing decisions based on task type (code vs. design vs. editorial), not just backend availability?
4. What does `gwrk gate-check` look like as a first-class command? Separate from `gwrk tasks done`?
5. How do design tools (v0, Lovable, Stitch) integrate? Agent backends? External tools WUD calls?

---

## Anchors

- Source: [Why *nix](why-nix.md) — Manus backend lead post
- Relevant specs: [004-ship-loop](../../specs/004-ship-loop/spec.md), [008-agent-router](../../specs/008-agent-router/spec.md)
- Foxtrot Charlie: [FOXTROT-CHARLIE.md](../FOXTROT-CHARLIE.md)
