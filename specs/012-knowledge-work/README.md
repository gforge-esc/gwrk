# 012 Knowledge Work — EXTERNALIZED

> **Status:** Externalized to `gwrk-plugins`
> **Decision date:** 2026-06-21
> **Rationale:** Knowledge work is a plugin concern, not a gwrk core feature. It composes extensions (context providers), compound reasoning skills, and workflows — all of which are first-class plugin types.

## Architecture

012 is implemented as a **plugin bundle** in `gwrk-org/gwrk-plugins`:

| Plugin Type | Name | Purpose |
|---|---|---|
| Extension | `knowledge-vault` | Context provider — indexes markdown vaults |
| Skill (atomic) | `knowledge-capture` | Structured note intake |
| Skill (compound) | `knowledge-synthesize` | 3-pass reasoning: Forensic → Synthetic → Calibration |
| Workflow | `gwrk-capture` | Note capture via `gwrk discover capture` |
| Workflow | `gwrk-synthesize` | Synthesis via `gwrk discover synthesize` |

## gwrk Core Surface

The only core touch is a thin CLI command under `gwrk discover` that calls `WorkflowRuntime.execute()`. All substance lives in `gwrk-plugins`.

## Related Research

- R008: Ontology & Identity
- R009: gwrk Ontology
- R011: Obsidian Vault as Discovery Source

## Reasoning Modes

Uses compound skill stacks from `docs/archive/reference/reasoning-skills.md`:
- **Forensic** — Work backward from conclusions to evidence
- **Synthetic** — Connect notes into unified framework
- **Calibration** — Rate confidence, flag gaps
