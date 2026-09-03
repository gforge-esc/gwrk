---
initiative: adr-first-class
prefix: R012
methodology: technical
status: open
created: 2026-08-20
---

# R012: adr-first-class

## Objective

Design the feature that makes an architecture decision record a gwrk artifact rather than a file a
human remembers to write. Authoring, lifecycle, and reach into agent context.

Read `docs/research/R012-adr-first-class/references/survey.md` before anything else. It is the
evidence base for this brief: seven parallel readers over every subsystem the feature touches, with
file:line citations and thirteen defects found in passing. Do not re-derive it. Verify it where a
claim carries weight, and say so when a claim does not hold.

### The case

`docs/decisions/` holds nine ADRs. `gwrk init` creates the directory. One code path reads it, and it
mislabels the contents: `source-scanner` slurps all nine into `material.patterns`, which
`define ontology --run` renders under the heading `## Code Patterns`.

ADR-006, ADR-007 and ADR-008 are named by zero builtin prompts. ADR-007 is the doctrinal authority
that both the 026 correction and the unwritten 028 correction amend. No agent has ever read it.

`ship-orchestrator.ts:492` claims authority from "ADR-007 + 028 correction". That correction block
does not exist. Neither does `specs/028-*`. The decision was made, the code shipped citing the
record, the record was never written. This is workstream W4/W5 of
`docs/code-review-verdict-defect.md`, and the doc there names the failure mode: **definitional
cascade**. A code fix that narrows a written doctrine obliges amendments upstream, or the next agent
reads the old doctrine and reintroduces the bug.

The one prior execution of a cascade, spec 026's drift ledger, took four ADRs and six specs edited
by hand in a follow-up commit. Nothing verifies it: `drift-detector.getDriftArtifacts()` returns
`["specs", "ROADMAP.md", ".gwrkrc.json", "package.json"]`.

R007 named the shape of this failure for the ontology: ADR-009 shipped the plumbing (injection) and
missed the faucet (construction). For decisions it is inverted. The faucet half exists (`init`
creates the directory, `source-scanner` already reads every file) and the plumbing does not (no
`groundingFiles` row, no tag, no index).

## Methodology: technical

Settled before this research starts. Treat these as constraints, not options, and do not spend the
draft relitigating them.

| Fork | Settled |
|---|---|
| Scope | Author + inject + lifecycle. Phased so authoring lands first and delivers value alone. |
| Surface | `gwrk define adr`, a sibling of `research` and `ontology`. |
| State | ADR markdown is the only source of truth (Tier 1 per ADR-003). Status, supersedes and depends-on are derived on demand. No SQLite table, no spine node. |
| Day-one target | Both. `gwrk init` already scaffolds the directory for a greenfield repo, and the nine existing ADRs must be readable by the feature. |

"No spine node" is load-bearing rather than merely cheap: `plan-store.ts:101-109` prunes any
`plan_features` row with no matching `specs/` directory, so an ADR modelled as a feature row gets
deleted on the next sync.

Four constraints the survey established that bound every answer below:

1. Injection is a four-line diff to a literal array in `agent.ts:565-580`, in gwrk core. Not a plugin.
2. The injected artifact is one file and must stay small. The full corpus is 22k-29.5k tokens against a current total grounding payload of ~1.6k. Budget 340 to 1,000 tokens.
3. No placeholder substitution engine exists. `{{enforcement}}` and `{{architecture}}` both prove it: they reach the model as literal braces. Any design containing `{{decisions}}` in a `PROMPT.md` is already broken.
4. The methodology workflow must ship as a builtin. `define research --run` passes no `projectRoot`, so project-local plugin overrides are invisible on that path.

## Discovery

Answer these. Each changes the implementation. The first two are preconditions: answer them before
the rest, because they move the cost of everything below by roughly an order of magnitude.

**Is an ADR a requirement or a document?** `parser.ts:214` tokenizes `ADR-\d+` alongside `FR-`, `TC-`,
`US-` and `TR-` in a plan phase's `**Requirements Addressed:**` line, and humans already write ADRs
that way (`specs/014-plugin-system/plan.md` does it six times). The convention exists; the consumer
does not. `extractPhaseRequirements` has zero call sites, imported at `tests-generate.ts:17` and never
invoked, and nothing in the repo resolves a requirement id of any class. So treating ADRs as
requirements means writing the resolver, not reusing one. Decide whether that resolver is in scope,
knowing it would serve `FR-` and `US-` too.

**Which doctrine carrier is authoritative?** Four already exist: `docs/decisions/*.md` (nine files,
one code reader), `.gwrk/rules/*.md` (read only by the dead `server/context.ts:37-40`),
`.gwrk/agent-context.md` (synced into `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` by
`plugin sync-context`), and `~/.gwrk/plugins/skills/*/SKILL.md` (the enforcement-skill tier, already
scope- and profile-filtered via `skill-runtime.ts:167`). Rank them before adding a fifth path.
Adding one without ranking reproduces the half-wired ADR-009 outcome this feature exists to avoid.

**Metadata carrier.** Keep the blockquote header the nine files already use and parse it, or introduce
YAML frontmatter and migrate all nine. Parsing as-is avoids touching the corpus but inherits four
documented inconsistencies (two H1 styles, a section template that only 004-009 follow, a `Status`
field nobody updates, forward-only supersession). Migrating costs a one-time reconciliation and buys a
field a parser can trust. Weigh one cost the survey did not: the blockquote header is not an ADR quirk
but a house-wide convention. `plan-renderer.ts:33-38` emits `> **Status:** Authoritative · **Date:** …`
into every generated `specs/000-build-plan.md`, and `docs/grounding/architecture.md:4` uses the same
form. Moving ADRs to frontmatter forks the convention across artifact families and orphans the parser
from every other gwrk-authored header.

**Index provenance.** Hand-maintained, derived at command time, or derived at dispatch time? Dispatch-
time derivation means nine file reads inside a loop that today does three `existsSync` calls, on every
`dispatchToAgent`. Command-time derivation needs a trigger and can go stale. Hand-maintained
contradicts nothing in ADR-009 (which requires human review) but rots the moment ADR-010 lands.

**Index content.** Status plus the `Decision:` one-liner is the cheap shape. Is that enough for an
implementer to avoid violating a decision, or does the index need the constraint rather than the
summary? What earns its tokens.

**Carrier for the index.** A fourth `groundingFiles` row is not the only option, and it is not the
cheapest. `plugin sync-context` splices `.gwrk/agent-context.md` into `CLAUDE.md` between
`<!-- gwrk:begin -->` and `<!-- gwrk:end -->` (`claude/adapter.ts:27-55`, with equivalents for codex
and agy), hash-deduped through the `agent_context_sync` table. The agent CLI reads that file natively,
so the payload costs nothing per dispatch and nothing in the grounding loop. Weigh it against the
grounding row on freshness, reach across backends, and who owns regeneration. Worktree survival does
not separate them: `.gitignore` excludes only `.gwrk/server.pid` and `.gwrk/dispatches.jsonl`, so both
`.gwrk/agent-context.md` and `.gwrk/ontology/domain.md` are tracked. Note that only one of the three
existing grounding rows resolves today (`.gwrk/perspective/` does not exist), so a fourth row roughly
doubles what actually ships rather than adding a third.

**Status.** `Status` cannot compute "accepted": ADR-006 and ADR-007 read `Proposed` while being cited
as authority throughout `src/`. Correct the corpus as part of this feature, add a vocabulary
(`Superseded`, `Accepted`), or avoid filtering on status. Pick one and say why.

**Supersession.** ADR-002 supersedes ADR-001 "(storage mechanism only)". ADR-003 supersedes "Partial
aspects of ADR-002 §3". Supersession is partial and recorded forward only, so ADR-001 still reads
`Decided` with no back-reference. Does the derived graph carry the qualifier text, or does flattening
to a boolean mislead?

**Stable assertion ids.** "ADR-007 §78" is a line number. The 026 correction sits at line 80, so each
amendment shifts the address of the next. What addressing scheme lets a correction target something
that does not move, and does retrofitting it to nine files belong in this feature?

**Amendment as a first-class operation.** The corpus already has two established revision forms:
appended amendment sections with an `> **Amends:** §2.3` blockquote (ADR-005 §8-§12), and inline
correction blockquotes (`> **026 correction.**` at ADR-007:80). W4 is exactly this operation and its
markdown is already written. Does `gwrk define adr` generate a correction block, and how does it know
where to put it?

**Ratification, not authorship.** Whether an agent may author an ADR is already decided in practice:
`ADR-006`'s header reads `> **Author:** Antigravity`, and that ADR is load-bearing, cited from
`agent-backend.ts`, `manifest.ts`, `agent-registry.ts` and `agent.ts`. `gwrk-constitution/PROMPT.md:26`
already commissions agents to recommend new ADRs. The open question is who flips `Status: Proposed` to
`Decided`, and whether the command models that transition at all.

**Injection scope.** Every dispatch, or only some? The `groundingFiles` loop has no scope filter,
unlike `resolveEnforcementSkills`. The demand analysis says IMPLEMENT needs decisions most (it
currently receives none) and the four review prompts contain zero decision references. Weigh
per-stage gating against the cost of a uniform payload.

**Enforcement.** `define analyze` is the definitional quality gate and the string "ADR" does not appear
in its 215 lines. `drift-detector` looks like the cheaper path but is not one: `getDriftArtifacts()`
has no reader outside its own test, `plan verify` calls `verify()` which never consults that array, and
`verify()` reconciles `specs/` directories against `plan_features` rows without reading document text.
Adding `docs/decisions` to it is a no-op. So enforcement means either a new analyze pass or a new
checker. Which, and does it gate or only report?

**The unwired constitution.** `src/plugins/builtins/workflows/gwrk-constitution/` ships a valid
manifest (well-formed `outputSchema`, unlike `gwrk-ontology-construct`) and a `PROMPT.md` whose scope
is: review `docs/decisions/` for consistency and completeness, flag drift between documented decisions
and actual code patterns, recommend new ADRs for patterns that emerged undocumented. No code dispatches
it. `grep -rn 'gwrk-constitution' src/ --include='*.ts'` returns nothing. Decide whether the audit and
drift half of this feature is a new workflow or a wire-up of this one, and whether its prompt needs
changes to serve that.

**The three stale lists.** `plan-renderer.ts:38` stamps ADR-001..006 into every generated build plan.
`gwrk-plan/PROMPT.md:61-64` hardcodes ADR-001..004 for the Senior Architect writing every plan.
`docs/grounding/architecture.md` anchors to ADR-001..006 in three places with dead
`file:///Users/gonzo/…` links, and `gwrk-specify/PROMPT.md:25` loads that file on every specify run.
All three must read the one index. Specify how a `PROMPT.md` reaches it, given constraint 3.

`gwrk-plan/PROMPT.md:143-150` also has three dead pointers, not one: `decision-forge` (`:147`),
`specify-sharpen` (`:148`), and `.gwrk/rules/seeding-governance.md` (`:145`). None exists. Decide
whether repairing that table is in scope.

**Reach.** `slack-commands.ts:695` declares `validSubs = ["spec","plan","tasks","tests"]` and rejects
anything else, with the same list hardcoded at `:686`, `:778` and `slack-mentions.ts:135`. The handler
then calls `resolveFeature`, which throws without a `specs/` directory. Does `gwrk define adr` need to
work from Slack, and if so does the ADR case route around `resolveFeature`?

**Numbering and collisions.** Research and specs each have their own max+1 allocator with different
slug rules, no locking, and no existence check before mkdir. ADR numbering needs the same decision.
Note that the corpus is contiguous 001-009 and two files use a different H1 style.

## Conclusion

Produce `draft.md` in this directory containing:

1. The recommended design, one option per question above, with the rejected alternative and why.
2. Phase breakdown with the authoring phase standing alone as shippable value.
3. Every file to create or modify, by path, separating gwrk-core edits from builtin-plugin additions.
4. The ADR template the feature scaffolds, and the migration plan for the nine existing files if the metadata-carrier answer requires one. The template must follow the AGENTS.md §7 writing standard, since it is the enforcement point for every ADR gwrk ever writes.
5. The test surface: which existing suites need edits, which files are new. Note that `cli.ux.test.ts:43` needs `"define adr"` added or the `Examples:` invariant goes unenforced, and that `cli.option-collisions.test.ts` asserts set equality against a nine-entry baseline.
6. Which of the thirteen defects in the survey this feature must fix to work at all, versus which are separate. D1 (`--refs` silently discarded on `define research`) and D3 (feature number cannot be chosen) both affect the workflow that builds this feature.

Do not write production code. Cite file:line for every claim about current behaviour.
