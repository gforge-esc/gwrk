# Skills Architecture

> **Date**: 2026-03-15
> **Status**: Decided — ready for F014 spec
> **Derived from**: [OpenClaw Research](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-openai.md), [Manifest Stress Test](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-deep-analysis.md), reasoning-modes taxonomy

---

## Core Principle

Skills are **CLI commands**, not context blobs. They inherit the full F013 agent-native interface: stdin/stdout, `--format json`, `[exit:N | Xs]`, `--agent` mode, pipe-composable. This is the anti-MCP position — gwrk skills are Unix-native, not server-coupled.

```bash
gwrk skill narrative < brief.md --format json       # Atomic
gwrk skill signal-cut < brief.md                     # Compound
gwrk skill narrative < brief.md | gwrk skill reductive  # Pipe composition
gwrk skill --help                                    # Discovery
```

---

## Two-Tier Hierarchy

### Atomic Skills (reasoning primitives)

Each reasoning mode from `reasoning-modes.md` is a standalone, invocable skill. One pass, one mode, one prompt.

```
~/.gwrk/plugins/skills/
├── narrative/           ← Creative > Narrative
│   ├── manifest.yaml
│   └── SKILL.md
├── forensic/            ← Reasoning > Forensic
├── reductive/           ← Reasoning > Reductive
├── adversarial/         ← Evaluative > Adversarial
├── interviewer/         ← Communication > Interviewer
├── audit/               ← Evaluative > Audit
└── ... (~40 from taxonomy)
```

```yaml
# Atomic manifest
type: skill
name: narrative
tier: atomic
version: 1.0.0
description: "Frame content as story arc with tension, turn, resolution"
category: creative
prompt: >
  TURN THIS INTO A STORY ARC. WHAT'S THE TENSION, THE TURN, THE RESOLUTION?
interface:
  input: stdin
  output: stdout
  exitCodes:
    0: success
    1: failed
    2: usage error
runtime:
  preferredAgent: gemini
  preferredModel: gemini-2.5-pro
  maxInputTokens: 16000
tags: [reasoning, creative, narrative]
```

### Compound Skills (multi-pass compositions)

Compose atomic skills into sequential passes. One LLM call assembles all passes into a single prompt from SKILL.md.

```
~/.gwrk/plugins/skills/
├── signal-cut/          ← narrative → subversive → practitioner
│   ├── manifest.yaml
│   └── SKILL.md
├── specify-sharpen/     ← reductive → interviewer → audit
├── decision-forge/      ← adversarial → steel-man → calibration
├── truth-extract/       ← forensic → socratic → uncertainty
└── architecture-stress-test/  ← analytical → pre-mortem → comparative
```

```yaml
# Compound manifest
type: skill
name: signal-cut
tier: compound
version: 1.0.0
description: >
  Compound skill for marketing content that converts skeptical
  technical audiences.

composes:
  - narrative
  - subversive
  - practitioner

passes:
  - name: narrative
    skill: narrative
    summary: "Frame as story arc with tension, turn, resolution"
  - name: subversive
    skill: subversive
    summary: "Violate the expected approach for this content type"
  - name: practitioner
    skill: practitioner
    summary: "Strip what fails the Monday morning test"

interface:
  input: stdin
  output: stdout
  flags:
    - name: --content-type
      values: [launch-post, blog, social-thread, demo-script, newsletter]
      required: false
    - name: --audience
      default: "skeptical technical practitioners"
    - name: --product
      description: "Product name for voice context"
  exitCodes:
    0: success
    1: generation failed
    2: usage error

context:
  required: [input]
  optional: [audience, product, content-type]

outputContract:
  - "Has a recognizable tension the reader has lived through"
  - "Does NOT follow the expected template for its content type"
  - "Contains at least one concrete demonstration"
  - "Passes the 'would a PE forward this?' test"
  - "Has one clear call to action that isn't 'sign up'"

runtime:
  preferredAgent: gemini
  preferredModel: gemini-2.5-pro
  fallbackAgent: claude
  fallbackModel: claude-opus-4-6
  maxInputTokens: 16000
  expectedLatency: "10-30s"

tags: [content, marketing, writing, developer-tools]
```

---

## Manifest Boundary

| In `manifest.yaml` | In `SKILL.md` |
|---------------------|---------------|
| Identity (name, tier, version) | "When This Fires" / "Why This Exists" |
| Composed skill refs | Detailed pass instructions |
| Pass names + summaries | Prompt injections (`> TURN THIS INTO...`) |
| Interface contract (I/O, flags, exit codes) | Playbook tables, reference data |
| Context requirements | Prose examples and guidance |
| Output contract (checklist) | |
| Runtime config | |
| Tags | |

> **manifest.yaml** answers: *what is this, what does it need, what does it produce?*
> **SKILL.md** answers: *how does this think?*

---

## Execution Model

```
gwrk skill signal-cut < brief.md
        │
        ▼
┌─────────────────────────┐
│  Skill Runtime           │
│                          │
│  1. Resolve skill        │  ← ~/.gwrk/plugins/skills/signal-cut/
│  2. Load manifest.yaml   │  ← Contract: composes, interface, context
│  3. Load SKILL.md        │  ← Reasoning program
│  4. Assemble prompt      │  ← SKILL.md + stdin + flags + context
│  5. Invoke agent CLI     │  ← YOLO mode (e.g., claude --dangerously-skip-permissions --model <model> -p "<prompt>")
│  6. Parse output         │  ← Validate format (not quality)
│  7. Emit stdout          │  ← JSON or markdown
│  8. Signal stderr        │  ← [exit:0 | 12.3s]
└─────────────────────────┘
```

Single LLM call. Passes are instructions within one prompt, not a pipeline. Output contract is LLM-enforced; runtime validates format only.

---

## Scoping

Skills are **global only** — installed at `~/.gwrk/plugins/skills/`. They are capabilities of the operator, not properties of a project. No local overrides.

---

## Why Not MCP

| MCP | gwrk Skills |
|-----|-------------|
| Server-coupled (requires running process) | CLI commands (just exec) |
| JSON-RPC protocol | Unix stdin/stdout |
| Not pipe-composable | Pipe-composable by design |
| Context-oblivious (dump everything) | Context-declared (manifest.yaml) |
| Tool-oriented (functions) | Reasoning-oriented (thinking patterns) |
| Discovery via schema blob | Discovery via `--help` |
| No operational signals | `[exit:N \| Xs]` on stderr |

---

## Seed Library

F014 generates atomic skills from the `reasoning-modes.md` taxonomy (~40 modes across 7 categories: Reasoning, Evaluative, Creative, Persona, Communication, Operational, Meta). Existing compound skills (signal-cut, specify-sharpen, decision-forge, truth-extract, etc.) get manifests added.
