# R012 Survey: the ADR surface as it stands

Seven parallel readers over the subsystems an ADR feature must plug into, 2026-08-20, against
`6a6bff6` on `fix/review-finding-liveness`. Every claim carries a file:line. Claims marked
**[probed]** were verified by running code, not by reading it.

## 1. What exists

`docs/decisions/` holds nine hand-written ADRs, `ADR-001` through `ADR-009`, 117,866 bytes.
`gwrk init` creates the directory ([init.ts:430-435](../../../../src/commands/init.ts#L430-L435)).
No command writes into it.

One code path reads it. [source-scanner.ts:57-69](../../../../src/engine/source-scanner.ts#L57-L69)
readdirs `docs/decisions/`, slurps every `.md` into `material.patterns`, and
[define-ontology.ts:36-50](../../../../src/commands/define-ontology.ts#L36-L50) renders that array
into the ontology prompt under the heading `## Code Patterns`. All nine ADRs reach one prompt, in
one project, mislabelled.

`grep -i '\badr\b'` over `src/` finds three consumers: that scanner, a `ADR-\d+` token regex in
[parser.ts](../../../../src/utils/parser.ts) `extractPhaseRequirements`, and a hardcoded link list
in [plan-renderer.ts:38](../../../../src/engine/plan-renderer.ts#L38). No `Command` named `adr` or
`decision` exists among the 44 declared in `src/commands/`.

## 2. Corpus shape

Every file is `docs/decisions/ADR-00N-<kebab-slug>.md`, contiguous 001-009, 171 to 401 lines.

**No file has YAML frontmatter.** Each opens with an H1, then a blockquote metadata block:

```
# ADR-003: Execution State Contract — Git-Native Manifests

> **Status:** Decided · **Date:** 2026-03-08
> **Decision:** Git-native execution manifests + build-server-side SQLite harvest
> **Supersedes:** Partial aspects of ADR-002 §3 (Learning Loop Extraction)
> **Author:** David Gonzalez · **Decision Scope:** gwrk state architecture
```

Fields: `Status`, `Date`, `Decision`, `Author`, `Decision Scope`, plus `Supersedes` (002, 003) or
`Depends on` (004-009). ADR-001 carries neither.

Four inconsistencies a parser must absorb or a migration must fix:

| | Detail | Files |
|---|---|---|
| H1 style | `# ADR: <title>`, number only in the filename | 001, 002 |
| | `# ADR-00N: <title>` | 003-009 |
| Status vocabulary | Only `Decided` and `Proposed` exist. No `Superseded`, `Accepted`, `Rejected`, `Deprecated`. | all |
| Stale status | `Proposed` despite being implemented and cited as authority throughout `src/` | 006, 007 |
| Section template | `## 1. Context` universal. `Decision Record` block (Position / Confidence / Reversibility / Risk) in 004-009 only. `Confidence:` line in 007, 008, 009 only. `## References` in 007, 008, 009 only. Impact section named `Impact on Existing Code` (002-005) or otherwise. ADR-001 has two `## 7.` headings. | |

**Status cannot compute "accepted."** Filtering `Status: Decided` drops ADR-006 and ADR-007, the two
that define the dispatch path any injection would ride on.

**Supersession is partial and forward-only.** ADR-002 supersedes ADR-001 "(storage mechanism only)".
ADR-003 supersedes "Partial aspects of ADR-002 §3". ADR-001 still reads `Status: Decided` with no
back-reference. A boolean `superseded` flag would misrepresent all three.

**Revision happens in place, never by a new file.** Two established forms:

- Appended amendment sections with their own blockquote: `## 8. Amendment: Deterministic Vitest Gates (2026-03-16)` carrying `> **Amends:** §2.3, §2.4` ([ADR-005:199-401](../../../decisions/ADR-005-tdd-gate-architecture.md#L199)).
- Inline correction blockquotes patched into the original body: `> **026 correction.** …` ([ADR-007:80](../../../decisions/ADR-007-single-dispatch-path.md#L80)).

**Citations are line numbers.** "ADR-007 §78" means line 78. The 026 correction sits at line 80, so
each amendment shifts the address of the next. Assertions inside an ADR have no stable id.

## 3. Where decisions get made and lost

The define pipeline runs six stages, SPECIFY → PLAN → DEFINE_TESTS → PLAN_TO_TASKS → CHECKLIST →
ANALYZE ([define-orchestrator.ts:140-145](../../../../src/engine/define-orchestrator.ts#L140-L145)).
None is a decision stage.

`gwrk define plan` is the demand site. Its persona is "Senior Architect"
([gwrk-plan/PROMPT.md:3](../../../../src/plugins/builtins/workflows/gwrk-plan/PROMPT.md#L3)) and it
decides source layout, SQLite schema, Zod contracts, phase boundaries. Its outputs are `plan.md`,
`data-model.md`, `contracts/`. It has no ADR output and no instruction to produce one. The decision
lands as prose inside `plan.md §Architecture`, unfindable from any other feature.

Three dead or stale pointers in that one prompt and its renderer:

- [gwrk-plan/PROMPT.md:147](../../../../src/plugins/builtins/workflows/gwrk-plan/PROMPT.md#L147) routes "Architecture decisions" to `~/.gwrk/plugins/skills/decision-forge/SKILL.md`. That file does not exist. The 45 seeded skills are atomic reasoning modes; the compound `decision-forge` was never shipped.
- [gwrk-plan/PROMPT.md:60-64](../../../../src/plugins/builtins/workflows/gwrk-plan/PROMPT.md#L60-L64) hardcodes ADR-001 through 004 as "Decisions". ADR-005 through 009 are invisible to the architect writing every plan.
- [plan-renderer.ts:38](../../../../src/engine/plan-renderer.ts#L38) stamps ADR-001 through 006 into `specs/000-build-plan.md` on every render, dropping 007, 008, 009.

A third stale enumeration sits in the most authoritative doc.
[docs/grounding/architecture.md:4](../../../grounding/architecture.md) anchors to ADR-001 through 006
with dead `file:///Users/gonzo/Code/gwrk/…` links from another machine; `:19-24` is an ADR index table
covering the same six; `:206` labels the directory "ADR-001 through ADR-006". `gwrk-specify/PROMPT.md:25`
instructs every specify run to load this file.

Coverage across all builtin prompts: six of nine ADRs are named somewhere. **ADR-006, ADR-007 and
ADR-008 are named by zero prompts.** ADR-007 is the authority both the 026 and the unwritten 028
corrections amend.

Agents are not wholly ADR-blind. `gwrk-plan/PROMPT.md:102` instructs "Read
`docs/decisions/ADR-004-agent-native-output.md` (required)", and `gwrk-specify/PROMPT.md:29` does the
same. The accurate claim is narrower than "no agent reads an ADR": no gwrk code injects one, so every
read is agent-discretionary and unverified. Several prompts cite ADRs by section rather than by file
(`gwrk-author-gates/PROMPT.md:6` cites ADR-005 §8, `:23` cites §8.3, `:93` cites ADR-004 §2.4), which
is the coupling an amend-and-renumber operation breaks.

**Slack cannot reach a new define subcommand.**
[slack-commands.ts:695](../../../../src/server/slack-commands.ts#L695) declares
`const validSubs = ["spec", "plan", "tasks", "tests"]` and rejects anything else. The usage string at
`:686`, the help enumeration at `:778`, and `slack-mentions.ts:135` each hardcode the same list. The
handler then calls `resolveFeature(featureId, context.projectRoot)` at `:710`, which throws without a
`specs/` directory, so an ADR invocation cannot pass even with the allowlist widened.

`gwrk define analyze` is the definitional quality gate, persona "Principal Engineer", running six
detection passes ([gwrk-analyze/PROMPT.md:67-151](../../../../src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md#L67-L151)).
The string "ADR" does not appear in its 215 lines. The verifier that could catch "this plan
contradicts ADR-007" has no notion of decisions.

The IMPLEMENT stage receives no ADR context. `gwrk-implement/PROMPT.md` has zero ADR hits and the
inline prompt at [ship-orchestrator.ts:817-960](../../../../src/engine/ship-orchestrator.ts#L817-L960)
contains no `docs/`, `decisions/`, or grounding string. The implementer cannot read the decision it
is about to violate.

All four review plugins contain zero ADR or decision references. There is no reviewer of decisions.

### The terminal case

[ship-orchestrator.ts:492](../../../../src/engine/ship-orchestrator.ts#L492) claims authority from
"ADR-007 + 028 correction". ADR-007 has no 028 correction block. `specs/` has no 028 directory.
The decision was made, the code shipped citing the record, the record was never written. A future
agent grepping "028 correction" finds nothing and re-derives from the old doctrine.

[docs/code-review-verdict-defect.md:222-229](../../../code-review-verdict-defect.md#L222) names the
failure mode: **definitional cascade**, one of five workstream kinds. A code fix that narrows a
written doctrine obliges amendments upstream (the ADR stating the doctrine, the spec record, the
build-plan graph), or the next agent reads the old doctrine and reintroduces the bug. The coinage
appears nowhere else in the repo. Both its instances are ADR-shaped: amend an existing ADR (W4),
and create the record the amendment cites (W5). Neither landed. W4 ships pre-written markdown and
is sized XS.

Prior art for executing a cascade by hand: spec 026 carries a "Drift ledger" section enumerating
every contradicting statement with `[fixed]` marks, and a header declaring `Supersedes drift in:
ADR-003, ADR-005, ADR-007, …` ([026/spec.md:99-135](../../../../specs/026-gate-runner-convergence/spec.md#L99-L135)).
Four ADRs and six specs edited by hand in a follow-up commit.

Nothing verifies the cascade, and the engine that looks like the fix is not one.
[drift-detector.ts:124-126](../../../../src/engine/drift-detector.ts#L124-L126) `getDriftArtifacts()`
returns `["specs", "ROADMAP.md", ".gwrkrc.json", "package.json"]`, and its only reference outside its
own definition is its test. `plan verify` calls `verify()`, which never consults that array and
reconciles `specs/` directories against `plan_features` rows without reading document text. Adding
`docs/decisions` to it is a no-op.

## 4. Injection

One grounding loop exists, a three-entry literal inside `dispatchToAgent`
([agent.ts:567-581](../../../../src/utils/agent.ts#L567-L581)): `.gwrk/ontology/domain.md` →
`<domain_ontology>`, `.gwrk/perspective/hierarchy.md` → `<information_hierarchy>`,
`.gwrk/perspective/ux-posture.md` → `<ux_posture>`. Data-driven in shape, literal in content. No
config, manifest, or plugin hook feeds it. Adding ADRs means editing gwrk core, not shipping a
plugin.

**Two of those three rows are inert.** `.gwrk/perspective/` does not exist in this repo. `.gwrk/`
holds `agent-context.md`, `dispatches.jsonl`, `history.jsonl`, `ontology/`, `rules/`. Only
`ontology/domain.md` (5,908 B) ships today, so a fourth row roughly doubles the grounding payload
rather than adding a third to it. `ontology-scaffold.ts` creates `perspective/` but only
`gwrk define ontology` runs it, and `gwrk init` does not.

Per-file semantics: existence check outside the `try`, read inside. A missing file is skipped
silently. An unreadable one prints a dim warning and dispatch continues. Nothing throws, nothing
aborts, nothing lands in `.runs/*.log`. An ADR corpus injected here inherits fail-open: no
grounding, no evidence that grounding was skipped.

Assembly order is `<command_safety>`, then the three grounding tags, then `<external_context>`,
produced by two string prepends and one append. ADR-009 §3.1 proposed an ordered `stdinParts.push()`
list; the shipped code mutates a string.

Channel: the task prompt travels on **argv**, grounding on **stdin**. ClaudeAdapter puts the whole
prompt in `-p`. A `PROMPT.md` that needs to reference an injected decisions block would need both on
one channel.

### Two proofs that placeholders in prompts do not work

`{{enforcement}}` substitution gates on `dispatch.stdin.includes("{{enforcement}}")`
([agent.ts:535-536](../../../../src/utils/agent.ts#L535-L536)). `dispatch.stdin` is empty for every
production caller except skill-runtime, so review agents receive the literal string
`{{enforcement}}` and enforcement skills are never substituted on the ship or define paths.

`gwrk-ontology-construct/PROMPT.md:21-30` contains `{{architecture}}`, `{{specs}}`, `{{patterns}}`.
No substituter exists anywhere in `src/`. The agent receives the literal braces; the real material
arrives separately inside `<user_input>`.

Any ADR design that reads "put `{{decisions}}` in the PROMPT.md" proposes a mechanism that does not
exist and has already failed twice.

### Cost

| Payload | Tokens per dispatch |
|---|---|
| Full corpus, 9 files, 117,866 B | 22,000 to 29,500 |
| What grounding actually ships today (`domain.md` alone) | ~1,500 |
| Status + Decision one-liners, 9 entries | 340 to 1,000 |

Full-corpus injection multiplies grounding by roughly 18x, on three or more dispatches per ship
iteration. Not viable. The affordable shape is one committed index artifact and one new row in the
`groundingFiles` array.

### A fourth channel, at zero per-dispatch cost

`gwrk plugin sync-context` reads `.gwrk/agent-context.md` ([sync-context.ts:20](../../../../src/commands/sync-context.ts#L20))
and `agent-registry.ts:78-102` calls `adapter.syncGovernance()` on every available backend, hash-deduped
against the `agent_context_sync` table. `ClaudeAdapter.syncGovernance`
([claude/adapter.ts:27-55](../../../../src/plugins/builtins/agents/claude/adapter.ts#L27-L55)) splices
the content into the project's `CLAUDE.md` between `<!-- gwrk:begin -->` and `<!-- gwrk:end -->`.
`codex/adapter.ts` and `agy/adapter.ts` do the same for their own files.

The agent CLI reads that file natively, so the payload costs nothing per dispatch and nothing in the
`groundingFiles` loop. This is a working, shipping channel and the cheapest available carrier for a
doctrine summary. Worktree survival does not distinguish it from the grounding row: `.gitignore`
excludes only `.gwrk/server.pid` and `.gwrk/dispatches.jsonl`, so `agent-context.md` and
`ontology/domain.md` are both tracked.

ADR-009 set three constraints an ADR feature inherits: not a schema validator, not auto-generated
(human-reviewed), not mandatory ([ADR-009:177-182](../../../decisions/ADR-009-domain-ontology-information-hierarchy-ux.md#L177)).
Its named risk is prompt length, mitigated by "the author controls length". That mitigation collapses
here: the corpus grows with every decision and no human curates its total size. ADRs are the first
grounding layer whose size is not author-controlled.

ADR-009's taxonomy (Domain Ontology = what things mean, Information Hierarchy = what matters first,
UX Posture = how actors experience the system) has no slot for "why is it built this way and what may
not be reopened". A fourth lens, orthogonal to the three.

`src/plugins/context-provider.ts` is 24 lines of types with no logic. Its `ContextResult
{source, content, relevance}` contract is the natural home for a relevance-ranked ADR retriever, but
the only implementation channel is the extension plugin system: disabled by default, keyed off
`config.extensions`, receiving an always-empty `keywords` array, capped at 10,000 characters.

`src/plugins/builtins/rules/*.md` and `personas/*.md` are read by no code path. The only reader,
`compileContext()` (`server/context.ts:27`), has no production caller. Do not model ADR grounding on
them.

Three builtin workflows ship unwired: `gwrk-constitution` (ADR governance, the audit half of this
feature), `gwrk-cascade-sync` (a *code* cascade, persona "Senior Developer (System Integration)",
ending in `pnpm build` and `pnpm test`), and the legacy bare `gwrk-research`. Do not repurpose
`cascade-sync` and do not name anything in this feature "cascade": the collision would read as a
wire-up of an existing workflow.

## 5. Command surface

`define` is a parent Command carrying its own positional argument, its own `.action()`, and two
options (`--refs <path>`, `--dry-run`). Subcommands attach afterward
([define.ts:52-67](../../../../src/commands/define.ts#L52-L67), registrations at
[199-215](../../../../src/commands/define.ts#L199-L215)).

Two registration conventions. Six subcommands import a fully-built `Command` from their own file.
`ontology` alone is constructed inline in `define.ts` and never exported, which is why
[define-ontology.test.ts](../../../../src/commands/define-ontology.test.ts) has one real test and one
empty stub. Its flags are structurally untestable. Copy `researchCommand`.

`define research` disambiguates its single positional at runtime by regex, not by commander:
`isPrefix()` tests `/^R\d{3}$/i`. A prefix routes to `resolveByPrefix` (find, never create);
anything else routes to `scaffold` (create, idempotent by slug).

`--methodology` resolves explicit flag > `methodology:` in brief frontmatter > `"technical"`, then
becomes a workflow name by concatenation: `` `gwrk-research-${methodology}` ``. No table, no
allowlist, no enum. An unknown methodology produces `PluginNotFoundError` at resolve time.

Scaffold always runs and sets a default return string. `--run` wraps the dispatch in `if (args.run)`
and overwrites that string. Without `--run` nothing dispatches.

`define ontology` takes no positional because it operates on the project: one ontology, nothing to
name. Its `--agent <agent>` shadows the root program's boolean `--agent`. The collision walker
exempts root options, so no test fires.

Neither `research` nor `ontology` records a ledger row, writes an execution manifest, notifies
PlanStore, or supports `--dry-run`. They are the light members of the family; the five
feature-scoped ones are heavy, sharing a copy-pasted `startRun` → try/catch → `finishRun` →
`writeManifest` → `recordHistory` block.

`define research` is the only define subcommand that skips `withSignal`. It catches, `console.error`s,
and calls `process.exit(1)`, which drops the `[exit:N | Xs]` line ADR-004 requires on every command.

No define subcommand supports `--format json`, though the root declares and validates it.

## 6. Scaffolding and numbering

Three artifact families, three numbering implementations, three registration styles.

| Family | Home | Allocator | Registered by |
|---|---|---|---|
| Research | `docs/research/R0NN-<slug>/` | `research-scaffold.ts:47-73`, max+1 over `/R\d{3}-/` | created lazily by the scaffolder |
| Spec | `specs/0NN-<slug>/` | `scaffold-feature.ts:74-118`, max+1 over `/^(\d+)/` | `gwrk init` creates `specs/` |
| Ontology | `.gwrk/ontology/`, `.gwrk/perspective/` | singleton | `gwrk define ontology` |
| Decisions | `docs/decisions/` | none | **`gwrk init` already creates it** |

Research scaffolds one directory and one file: `brief.md`. `draft.md` and `references/` are
conventions, not scaffolded. Frontmatter is five keys (`initiative`, `prefix`, `methodology`,
`status`, `created`); only `methodology` is ever read back. Of 11 initiatives on disk only R008,
R009 and R011 carry frontmatter; R001-R007 and R010 are hand-written with a different header.

The research candidate filter runs on raw readdir output with no `isDirectory()` check, so any file
matching `R\d{3}-` counts. `resolveByPrefix` is a case-insensitive `startsWith`. Both resolve from
`process.cwd()` joined with literal `"docs","research"`, with no project-root discovery, unlike
`init.ts` which walks parents for `.gwrkrc.json`.

Every artifact path in the codebase is a hardcoded literal. Config declares seams nothing reads:
`GwrkConfigSchema.project.architecture` accepts `{doc, decisions}`
([config.ts:86-95](../../../../src/utils/config.ts#L86-L95)), and
`config.project.architecture.decisions` is read nowhere. The decisions path is hardcoded at both the
scanner and the init scaffolder.

`.gitattributes` covers `specs/**/.gwrk/*` merge strategies only. Nothing covers `docs/research` or
`docs/decisions`.

## 7. Plugin runtime

A workflow manifest has six legal fields: `type: workflow`, `name` (`/^[a-z0-9-]+$/`), `version`
(strict `/^\d+\.\d+\.\d+$/`), `description`, `outputSchema` (required, `z.record(z.any())`),
`enforceOutputSchema` (optional bool).

**[probed]** Unknown keys are silently stripped, not rejected. `AnyManifestSchema` is a union of
non-strict objects, so a manifest carrying `adrDir: docs/decisions` parses and the field vanishes.
`gwrk-adr-record` and `adr-001` pass name validation; `gwrk_adr` and `gwrk-ADR` are rejected;
version `0.1` and `1.0.0-alpha.1` are rejected.

`outputSchema` is not validated as JSON Schema. It is stringified into an `<output_contract>` block
in the prompt and checked by a shallow hand-rolled validator. Whatever it declares, the runtime hard-
requires a `{summary, intents[]}` envelope and throws `Missing 'intents' array` otherwise.
`gwrk-ontology-construct`'s manifest declares no `summary` and no `required`, so its validation does
nothing and its summary falls back to a literal string.

Resolution order in `PluginLoader.resolvePlugin`: `.gwrk/plugins.yaml` override, then
`<projectDir>/.gwrk/plugins/<type>/<name>`, then `~/.gwrk/plugins/<type>/<name>`, then
`builtins/<type>/<name>`.

**`define research --run` passes no `projectRoot`.** `executeWorkflow` falls back to a default
`new PluginLoader()` with no `projectDir`, so project-local overrides are invisible on this path. An
ADR methodology workflow must ship as a builtin.

Shipping a new builtin requires exactly two files and a build: create
`src/plugins/builtins/workflows/<name>/{manifest.yaml, PROMPT.md}`, run `npm run build`. Postbuild
copies the whole tree. No test enumerates or counts the 20 existing workflow dirs.
`~/.gwrk/plugins/workflows` is empty on this machine; every workflow in use resolves from builtins.
`seed.ts` seeds skills only and mentions workflows nowhere. `gwrk plugin update` runs `git pull` in
plugin dirs that happen to contain `.git`.

`IntentEngine` executes `WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND` sequentially, resolving paths
against `projectRoot` with a `startsWith` containment check. Four defensive filters drop intents
first: `RUN_COMMAND` containing `>`, `>>` or `tee`; `WRITE_FILE` ending in `tasks.json`; `WRITE_FILE`
that would replace an existing file with strictly less content; and an optional `allowedPaths`
allowlist.

The agent learns where to write from prose in `PROMPT.md` plus the caller-appended
`<research_context>Directory: …` block.

`[type: X] … [/type]` guards are resolved before dispatch: `generic` always kept, `gwrk-native` kept
when the profile is gwrk, others matched against `profile.type`.

## 8. Ledger and spine

Fourteen data tables plus `_migrations`. No decisions table. `runs.feature_id` is `NOT NULL`.

`gwrk define research` and `gwrk define ontology` write no ledger rows. The live DB's distinct
`runs.command` values contain no research or ontology entries.

The spine models two node kinds, `plan_features` and `plan_phases`. In the solver **only phases are
graph nodes**; a feature id on an edge expands to its phases, and a feature with zero phases
vanishes from the graph. `plan_edges.edge_type` is free-text with no CHECK; the CLI writes only
`DEPENDS_ON` and the recursive query hard-filters on it.

`gwrk plan init` treats any directory under `specs/` as a feature and prunes rows with no matching
directory. `plan verify` flags graph rows without a directory as `MISSING_FROM_SPECS` drift.

`plan_proposals`, the only human-reviews-agent-suggestion table, is hard-bound to phases
(`target_phase_id NOT NULL`) and is **dead code**: `insertProposal` writes an `updated_at` column the
table does not have, so every write path throws at statement-prepare time.

Migrations are `.sql` files applied in lexicographic order, recorded by filename, each via one
`db.exec` with no transaction. Numbering is already inconsistent: `002_pr_tracking.sql` uses an
underscore, and two files share the `003` prefix.

ADR-003 draws the tier line. Tier 1 (git) is "the source of truth for what work has been done":
`tasks.json` with `merge=ours`, `runs/*.json` manifests with `merge=binary`. Tier 2 (SQLite) is the
analytical ledger. The task spine below phases is entirely Tier 1; there is no tasks table.

An ADR run row would be write-legal but unreadable: `gwrk db runs <feature>` passes its argument
through `resolveFeature`, which throws unless it resolves to a real `specs/` directory. It is also
inert with respect to the spine, since `getShippedPhases` filters `command='ship'`.

`history` could carry ADR transitions with no schema change (`task_id` is unconstrained TEXT), but
the typed wrapper cannot: `appendHistory`'s Zod schema requires `taskId` to match `/^T\d{3}$/`.

## 9. Test harness

`cli.consistency.test.ts` is 91 lines and enforces two things, neither of them a general sweep:
feature-argument position for a hardcoded list of 10 command paths, and two no-duplicate-surface
rules. A new `define adr` passes it untouched.

The `Examples:` invariant lives in [cli.ux.test.ts:42-64](../../../../src/cli.ux.test.ts#L42-L64),
over a hardcoded list of 11 paths. Add `"define adr"` to `commandsWithExamples` or the invariant goes
unenforced.

`cli.option-collisions.test.ts` walks the real `program` tree and compares each command's `option.long`
strings against every non-root ancestor's. It has two assertions and a new collision fails both: one
filters against `HANDLED ∪ VERIFIED_BENIGN` expecting `[]`, the other asserts **set equality**.
Baseline is nine entries.

`cli.e2e.test.ts` spawns `node dist/cli.js` and freezes `define --help`: `spec`, `plan`, `tasks` must
appear; `analyze`, `specify`, `generate`, `implement`, `ship` must not. `research` and `ontology`
appear in real output and are asserted neither way. A visible `adr` passes untouched; asserting it
is the deliberate move.

Precedents to copy, and to avoid:

- `research.test.ts` is handler-level: import `researchCommandHandler`, mock the engine, assert the returned string. Keep `console.log` in the action only.
- `research-dispatch.test.ts` and `research-brief-injection.test.ts` hold the real `--run` conventions: mock `WorkflowRuntime`, `node:fs/promises`, `loadConfig`, `resolveModelForTask`, then assert `executeWorkflow` was called with the workflow name, an input containing brief content, and `{agent, model}`, and that the runtime is never constructed without `--run`.
- `define.dry-run-ledger.test.ts` asserts a repo-wide contract: no `define … --dry-run` may call `startRun`. It mounts the real `defineCommand` under a root with `enablePositionalOptions()`, because a bare parent removes the collision under test.
- Engine scaffolder tests mock `node:fs/promises` wholesale and assert on `mkdir`/`writeFile` arguments.

`GWRK_SKIP_INTEGRATION` is a vitest exclude switch set by `test:ci`. Keep an ADR suite hermetic and
no quarantine entry is needed. Every test retries once, so a flaky test is silently masked.
`tsconfig.json` excludes `**/*.test.ts` and biome ignores most test globs, so type and lint errors in
`src/commands/*.test.ts` and `src/engine/*.test.ts` are invisible to both gates.

Test titles must embed an `FR-`/`US-`/`TR-` id: `scripts/dev/test-report.ts` extracts the first such
token and maps it to a feature through that spec's `gap-matrix.md`.

CI is install → build → test:ci → lint with `continue-on-error`. Lint cannot block. Build and
test:ci can.

**The pre-commit hook is not installed in this clone.** `scripts/hooks/pre-commit` exists, but
`.git/hooks/pre-commit` is absent and `core.hooksPath` is unset. Nothing injects the MPL header and
nothing runs the build. AGENTS.md's "mechanically enforced, not trust-based" does not hold here. Add
the 3-line MPL block to every new `.ts` file by hand and run `npm run build` manually.

## 10. Defects found in passing

Independent of the ADR feature. Each is a candidate fix.

| # | Defect | Evidence |
|---|---|---|
| D1 | `--refs` on `define research` is silently discarded. It binds to the parent `define`; `research.ts` reads its own `opts.refs` and never calls `withParentFlags`. **[probed]**: `subcommand opts {"run":true}` / `parent opts {"refs":"docs/x.md"}`. The form is advertised in research's own `--help`. | [research.ts:172](../../../../src/commands/research.ts#L172) vs [define.ts:66](../../../../src/commands/define.ts#L66) |
| D2 | `cli.option-collisions.test.ts` lists `"define research --refs"` under `HANDLED`, documented as "handled by `withParentFlags`". `research.ts` is the one define subcommand that never calls it. The test passes while the behaviour is broken. | [cli.option-collisions.test.ts:31-40](../../../../src/cli.option-collisions.test.ts#L31-L40) |
| D3 | `opts.number` in `specify.ts` is dead code: both ternary branches return `undefined`, so a feature number can never be chosen. Passing a numeric prefix gets slugified into the name, producing `specs/028-029-decision-records/`. | [specify.ts:125-127](../../../../src/commands/specify.ts#L125-L127) |
| D4 | `getHighestFromDb()` is hardcoded `return 0`, so `getNextFeatureNumber` consults only `specs/` despite its doc comment claiming both. | [scaffold-feature.ts:98-107](../../../../src/utils/scaffold-feature.ts#L98-L107) |
| D5 | `scaffoldFeature` copies `specs/spec-template.md`, which does not exist in this repo. The copy silently no-ops. | [scaffold-feature.ts](../../../../src/utils/scaffold-feature.ts) |
| D6 | `{{enforcement}}` is never substituted on the ship or define paths. Review agents receive the literal placeholder. | [agent.ts:535-536](../../../../src/utils/agent.ts#L535-L536) |
| D7 | `{{architecture}}`, `{{specs}}`, `{{patterns}}` in `gwrk-ontology-construct/PROMPT.md` are never substituted. No substituter exists. | `gwrk-ontology-construct/PROMPT.md:21-30` |
| D8 | `plan_proposals` write paths all throw: `insertProposal` writes a nonexistent `updated_at` column. `gwrk plan review approve/reject` cannot work. | `src/db/plan.ts` |
| D9 | `plan-renderer.ts` stamps a stale ADR-001..006 list into every generated build plan. | [plan-renderer.ts:38](../../../../src/engine/plan-renderer.ts#L38) |
| D10 | `gwrk-plan/PROMPT.md` hardcodes ADR-001..004 and routes architecture decisions to a nonexistent `decision-forge` skill. | `gwrk-plan/PROMPT.md:60-64`, `:147` |
| D11 | `source-scanner`'s architecture arm looks for `docs/architecture.md`, `ARCHITECTURE.md`, `README.md`. The first two do not exist, so it silently falls back to README and ignores the 53 KB `docs/grounding/architecture.md`. | [source-scanner.ts:42-55](../../../../src/engine/source-scanner.ts#L42-L55) |
| D12 | `define research` skips `withSignal`, dropping the `[exit:N \| Xs]` line ADR-004 requires. | [research.ts](../../../../src/commands/research.ts) |
| D13 | Shipped code cites "ADR-007 + 028 correction". Neither the correction block nor `specs/028-*` exists. | [ship-orchestrator.ts:492](../../../../src/engine/ship-orchestrator.ts#L492) |

## 11. Constraints on the implementation

1. Injection is a four-line diff to a literal array in gwrk core, not a plugin. Accept that or change the array into something config-driven first.
2. The injected artifact must be one file, and small. Budget 340 to 1,000 tokens.
3. Do not put placeholders in `PROMPT.md`. No substitution engine exists.
4. Ship the methodology workflow as a builtin. `define research --run` cannot see project-local overrides.
5. Export the `Command` from its own module. Do not copy the inline ontology wiring.
6. Reusing `--refs` or `--dry-run` needs a `HANDLED` entry to satisfy CI and a `withParentFlags` call to actually work. The test asserts only set equality of discovered collisions, never that the call exists, so the allowlist entry alone turns CI green on a broken flag. That is how D1 shipped.
10. `parser.ts:214` tokenizes `ADR-\d+` alongside `FR-`, `TC-`, `US-` and `TR-` in a plan phase's `Requirements Addressed:` line, and `specs/014-plugin-system/plan.md` uses it that way six times. The convention exists with no consumer: `extractPhaseRequirements` is imported at `tests-generate.ts:17` and never invoked, and nothing in the repo resolves a requirement id of any class. Treating ADRs as requirements means writing the resolver.
11. `prompt-conditioner.ts:42-44` returns the prompt unchanged when the profile is missing or `unknown`, leaking raw `[type: …]` markers into the dispatched prompt.
12. Slack's `validSubs` allowlist and its `resolveFeature` call both block an ADR subcommand from the Slack surface.
7. `docs/decisions/` is already created by `gwrk init` and already fully read by `source-scanner`. The reader and the directory exist; the index and the injection row do not.
8. Status cannot compute "accepted", and supersession is not boolean. Either correct the corpus first or avoid filtering on status.
9. The nine real ADRs are the parser's only available test corpus, and they disagree with each other in four documented ways.
