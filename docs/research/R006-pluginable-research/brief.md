# Research Initiative: R006 — Pluginable Research Workflow

> **Status:** Brief — Open
> **Consumer:** F014 Plugin System (enforcement skills, project overrides)
> **Output:** `docs/research/R006-pluginable-research/draft.md`
> **Origin:** Daily-driver audit session 2026-06-02, Section M decontamination

---

## Objective

Design how `gwrk define research` becomes a pluginable, user-customizable workflow rather than a hardcoded CLI command. Different practitioners use fundamentally different research methodologies — JTBD, market landscape analysis, building a business case, competitive audit, user journey mapping, etc. The current `gwrk-research` workflow is a single PROMPT.md with one approach (brief → draft synthesis). The research system should support multiple approaches as installable plugins.

---

## Context (Collected Thoughts)

### Why research matters to gwrk

Research is the **upstream feeder** to `gwrk define spec --refs`. Today the `--refs` flag accepts a path to reference docs, but there's no structured process for producing those reference docs. The pipeline should be:

```
research brief → research execution → draft.md → gwrk define spec --refs docs/research/R00X/draft.md
```

This makes the research → spec pipeline a first-class gwrk flow, not a manual step.

### Why research must be pluginable

The current `gwrk-research` PROMPT.md encodes one research methodology: "read the brief, read every input document, answer every question, produce a draft reference document." This works for technical architecture research (R001-R005 were all technical investigations). But:

1. **JTBD research** — interviews, job stories, outcome-driven innovation frameworks. Different inputs (transcripts, surveys), different outputs (job map, outcome statements).
2. **Market landscape** — competitive analysis, TAM/SAM/SOM, positioning. Different inputs (competitor docs, market reports), different outputs (landscape matrix, positioning canvas).
3. **Building a case** — business case, investment thesis, ROI modeling. Different inputs (financials, usage data), different outputs (business case doc, pitch narrative).
4. **User journey mapping** — current-state and future-state flows, pain points, opportunities. Different inputs (observation notes, analytics), different outputs (journey maps, opportunity scores).

Each of these is a distinct **research plugin** — same brief → draft lifecycle, different prompts, different output schemas, different grounding context.

### Relationship to project perspective (M.3)

This connects directly to the **project perspective mechanism** (Section M, item 3). Research plugins are project-scoped — what research methodology you use depends on what kind of project you're building and what questions you're answering. The F014 enforcement skills framework (`.gwrk/plugins.yaml` overrides, `tier: enforcement`, project-local resolution) is the same infrastructure that research plugins would use.

The insight: enforcement skills handle **"how do we build?"** (coding standards, quality gates). Research plugins handle **"what should we build?"** (discovery, validation, evidence). Both are project-scoped. Both should use the same plugin resolution chain.

### Relationship to existing research artifacts

The `docs/research/` directory contains 5 completed research initiatives (R001-R005):

| Initiative | Topic | Status |
|-----------|-------|--------|
| R001 | Parallel dispatch architecture | Completed → fed F005 spec |
| R002 | Agent backend plugin model | Completed → fed F014 spec |
| R003 | Agent stage containment | Completed → fed F014 spec |
| R004 | Shareability readiness | Completed → fed F014 spec |
| R005 | Better build plan | Completed → fed plan engine |

All 5 used the same methodology (technical architecture investigation). The `cascade.md` file attempted to reconcile research findings into the build plan — but that's now superseded by the DAG engine (`gwrk plan`).

---

## Questions to Answer

### Q1: Plugin geometry for research

What's the right plugin shape? Options:

| Shape | Pros | Cons |
|-------|------|------|
| **Workflow plugin** (like `gwrk-research`) | Already has JSON intent engine, output schema, file mutation | Heavy — needs agent dispatch for every research run |
| **Skill plugin** (like `narrative`) | Lighter — stdin/stdout, composable | Can't do multi-file output (brief → draft + artifacts) |
| **Compound skill** | Multi-pass reasoning in one LLM call | Still limited to stdout output |
| **New plugin type: `research-pack`** | Purpose-built for the brief → draft lifecycle | More schema surface to maintain |

### Q2: Research CLI surface

Where does research live in the CLI grammar?

| Option | Command | Fits grammar? |
|--------|---------|---------------|
| Under `define` | `gwrk define research <initiative>` | Yes — research is pre-definition work |
| Under a new pillar | `gwrk discover <initiative>` | Maps to FC "Truth" pillar, but adds a top-level command |
| Under `plugin` | `gwrk plugin run research <initiative>` | Generic but loses semantic meaning |

### Q3: Brief schema standardization

Should briefs have a standardized schema (Zod-validated YAML frontmatter) or remain freeform markdown? Standardization enables:
- Plugin routing (which research methodology to use based on brief type)
- Validation (are all required sections present?)
- Progress tracking (which questions have been answered?)

### Q4: Research output as spec input

How does the research → spec handoff work mechanically? Options:
- `gwrk define spec --refs docs/research/R00X/draft.md` (current — manual path)
- Auto-discovery: spec workflow scans `docs/research/` for drafts tagged to its feature
- Brief declares `consumer: F014` and spec workflow pulls it automatically

---

## Input Documents

- `src/plugins/builtins/workflows/gwrk-research/PROMPT.md` — Current research workflow
- `specs/014-plugin-system/spec.md` — Plugin system spec (US-016, FR-014 enforcement skills)
- `docs/research/R001-*/brief.md` through `R005-*/brief.md` — Existing research briefs as precedent
- `docs/grounding/cli-grammar.md` — CLI naming conventions

## Anti-Patterns

- Do NOT implement the plugin type before the design is validated
- Do NOT assume all research is technical architecture investigation
- Do NOT hardcode research methodologies into gwrk core — they must be installable
- Do NOT break the existing `docs/research/R00X/{brief,draft}.md` lifecycle

---

## Output Contract

1. **`draft.md`** — Design document covering Q1-Q4 with recommendations
2. **Plugin manifest example** — Sample `manifest.yaml` for a JTBD research plugin
3. **CLI integration sketch** — How `gwrk define research` resolves and dispatches the right research plugin
