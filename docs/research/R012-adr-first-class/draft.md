# R012: ADRs as a gwrk artifact

Technical research draft. Every claim about current behaviour carries a file:line, verified against
`develop` at `5cd80cb`.

## 0. Corrections to the survey

Five findings that change an answer below. The brief has been amended to carry them.

### 0.1 The plan language does not treat an ADR as a requirement. It permits one.

`parser.ts:214` tokenizes `ADR-\d+`, but no machinery consumes it.

`extractPhaseRequirements`, the function containing that regex, has zero call
sites. `tests-generate.ts:17` imports it and never invokes it, as it does for `extractPhaseFiles`
(`:16`), `extractPhaseSection` (`:18`) and `extractSpecSections` (`:19`). All four are dead imports:
`grep -rn 'extractPhaseRequirements(' src/` returns only the definition at `parser.ts:207`. Nothing
in the repo resolves a requirement id of any class, `FR-` included.

The convention is real even though the code is not. `specs/014-plugin-system/plan.md` cites ADR-006
and ADR-007 in six `Requirements Addressed:` lines (`:33`, `:97`, `:121`, `:129`, `:313`, `:384`).
Humans already write ADRs as requirement-class identifiers. The consumer was never written.

### 0.2 The requirement/document fork would not have caught the phantom 028 correction.

The citation is `ADR-007 + 028 correction`. `ADR-007` resolves: `docs/decisions/ADR-007-single-dispatch-path.md`
exists. What does not exist is a correction block inside it. A resolver keyed on `ADR-\d+` passes this
citation.

Catching it requires resolving an intra-record assertion address, which is the stable-assertion-id
question (§1.9), not the requirement/document question. That re-ranks the discovery list: the defect
motivating the feature is closed by the amendment registry, not by the first precondition.

### 0.3 Teaching `drift-detector` about `docs/decisions` changes no behaviour.

`getDriftArtifacts()` (`drift-detector.ts:124-126`) has one reference outside its own definition: its
test at `drift-detector.test.ts:13`. `plan verify` constructs a `DriftDetector` and calls `verify()`
(`plan.ts:357-365`), which never reads that array. Adding `"docs/decisions"` to it is a no-op.

`DriftDetector.verify()` is also the wrong shape. It reconciles `specs/` directories against
`plan_features` rows and `tasks.json` statuses (`drift-detector.ts:32-117`). It reads no document
text, so it cannot see doctrine drift even if wired, and with no spine node for ADRs (settled) there
is nothing for it to reconcile against.

### 0.4 Worktree survival does not separate the two carrier candidates.

Worktree survival is not an advantage unique to the sync-context channel. `.gwrk/ontology/domain.md`
is git-tracked (`git ls-files .gwrk/ontology/`), as is `.gwrk/agent-context.md`. Only
`.gwrk/server.pid` and `.gwrk/dispatches.jsonl` are ignored (`.gitignore:7`, `:33`). Both candidate
carriers survive a worktree ship run.

### 0.5 A workflow the survey did not report

`src/plugins/builtins/workflows/gwrk-cascade-sync/` is a second unwired builtin.
`grep -rn 'cascade-sync' src/ --include='*.ts'` returns nothing. Its persona is "Senior Developer
(System Integration)", its pillar is "Shipping (Consistency)", and its algorithm propagates a source
change to consumer modules, ending in `pnpm build` and `pnpm test` (`PROMPT.md:21-31`).

It is a code cascade, not a definitional cascade. Do not repurpose it, and do not name anything in
this feature "cascade". The collision would read as a wire-up of an existing workflow when it is not.

---

## 1. Recommended design

### 1.1 An ADR is a document carrying a requirement-class identifier

Chosen: document. `ADR-NNN` stays a citable id that the plan language accepts, and this feature adds
no requirement semantics.

Rejected: ADR-as-requirement. Per §0.1 it inherits a convention, not machinery. Building resolution
checking for ADRs would give decisions stronger verification than functional requirements have,
which inverts the dependency: `FR-` ids are what specs are built from, and nothing checks those
either.

What the requirement framing does buy, and what this feature takes: a citation resolver over
`docs/decisions/` (§1.13). Twenty lines, no coupling to the plan graph.

### 1.2 Carrier ranking: decisions > enforcement skills > agent context > rules

| Rank | Carrier | Authority | State |
|---|---|---|---|
| 1 | `docs/decisions/*.md` | Doctrine | Nine files. One reader, mislabelling them (`source-scanner.ts:57-69` → `material.patterns` → `## Code Patterns` at `define-ontology.ts:48-49`) |
| 2 | `~/.gwrk/plugins/skills/*/SKILL.md` | Enforcement | Live, scope- and profile-filtered (`skill-runtime.ts:167`), reached from `agent.ts:538-562`. Global, not per-project. Substitution broken on define and ship paths (D6, `agent.ts:535`) |
| 3 | `.gwrk/agent-context.md` → `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` | Standing instruction | Live splice (`claude/adapter.ts:27-55`). Six lines today. Manual trigger only |
| 4 | `.gwrk/rules/*.md` | None | `operating-model.md`, `workspace.md` on disk. Read by no live code path. Cited as prose from `.gwrk/agent-context.md:4` and `gwrk-plan/PROMPT.md:145-146` |

`docs/decisions/` remains the single source of truth. No fifth carrier. The index is a derived
projection of carrier 1, delivered through the grounding channel, with one pointer line added to
carrier 3.

### 1.3 Metadata carrier: keep the blockquote header

Chosen: parse the blockquote the nine files already use, and reconcile four inconsistencies in place.

The decisive cost the brief flagged is real. The blockquote header is a house convention, not an ADR
quirk. `plan-renderer.ts:33-38` emits `> **Status:** Authoritative · **Date:** ${date}` followed by a
`> **Decisions:**` line into every generated `specs/000-build-plan.md`, and
`docs/grounding/architecture.md:3-4` uses the identical form. One parser can read all three artifact
families. Moving ADRs to YAML forks the convention and orphans the parser from every other
gwrk-authored header.

Rejected: YAML frontmatter. It buys a field a parser can trust, but the parser can trust the
blockquote too once §1.3.1's reconciliation lands, and the migration costs nine file rewrites plus
permanent divergence from `plan-renderer`.

Parser tolerances the corpus demands, all verified by reading the nine headers:

- Two H1 styles. `# ADR: <title>` in 001 and 002, number in the filename only. `# ADR-00N: <title>` in 003-009.
- ADR-001 uses trailing double-space hard breaks. The others do not.
- ADR-001 carries neither `Supersedes` nor `Depends on`.
- `·` separates two fields on one line: `Status` with `Date`, `Author` with `Decision Scope`.
- `Decision:` values run to 240 characters (ADR-008). The index truncates.
- ADR-002's `Supersedes` value is a dead `file:///Users/gonzo/Code/gwrk/…` link.

### 1.4 Index provenance: command time

Chosen: regenerated by the command that mutates the corpus, plus a standalone entry point.

Triggers: `gwrk define adr` after any write; `gwrk define adr --reindex` alone; `gwrk init` when
`docs/decisions/` is non-empty.

Staleness becomes detectable rather than assumed. The index carries a content hash over the nine
parsed headers, and `--reindex --check` exits non-zero when the hash disagrees with the corpus. Nine
header reads inside a command, none inside a dispatch.

Rejected: dispatch-time derivation. `dispatchToAgent`'s grounding loop does three `existsSync` calls
today (`agent.ts:583`). Nine file reads and a parse on every dispatch, three or more per ship
iteration, buys freshness the command-time trigger already provides.

Rejected: hand-maintained. It contradicts nothing in ADR-009, which requires human review
(`ADR-009:177-182`), and it rots at ADR-010. That is the half-wired outcome this feature exists to
avoid.

### 1.5 Index content: status plus constraint, not summary

Status and the `Decision:` one-liner are not enough. ADR-007's decision line reads "All workflow
dispatch flows through `WorkflowRuntime`." An implementer reads that and still does not know a
`spawn("claude")` is forbidden.

Chosen: a new `> **Constraint:**` header field, one imperative sentence, authored with the ADR and
projected into the index.

```
| ADR | Scope | Status | Constraint |
```

Nine rows at roughly 37 tokens each, plus a three-line preamble, lands near 380 tokens. Inside the
brief's 340-1,000 budget, with about 35 tokens per future ADR. The template caps the field at one
sentence, which defers the ceiling to roughly ADR-030.

Rejected: index the summary only. Cheaper by ~10 tokens per row and it fails at the job, per the
ADR-007 example.

Rejected: derive the constraint. It is not in the header today. It is in each ADR's `Decision Record`
block (present in 004-009), so the reconciliation lifts nine one-liners from text that already exists.

### 1.6 Carrier for the index: a fourth grounding row, with one pointer line in agent context

Chosen: `.gwrk/decisions/index.md` → `<architecture_decisions>`, a fourth entry in the
`groundingFiles` array at `agent.ts:567-581`.

The brief pushed toward `.gwrk/agent-context.md` on cost. Four verified facts move the ranking back:

1. `syncGovernance` replaces the entire marker block with the whole content of `.gwrk/agent-context.md`
   (`claude/adapter.ts:45-49`). Putting the index there means the index owns the file, destroying the
   six hand-written lines, or something composes the file. Composition puts a generator in charge of a
   hand-written artifact, which is the ownership ambiguity that rots.
2. The trigger is manual only. `syncAllBackends` has exactly one caller: `sync-context.ts:31`. Nothing
   in `init`, `define` or `ship` calls it. An ADR authored today reaches no agent until a human runs
   `gwrk plugin sync-context`.
3. Reach is machine-dependent. Each backend is gated on `isAvailable()` (`agent-registry.ts:91`),
   which shells out to `which claude`. A backend not installed locally never receives the splice.
4. Worktree survival is symmetric (§0.4), so the advantage the survey attributed to this channel does
   not distinguish it.

The grounding row is read from disk inside `dispatchToAgent` (`agent.ts:583-598`): always fresh, no
trigger, no ownership question, uniform across backends because it rides stdin identically for all of
them.

Cost is smaller than the brief feared. Only one of the three existing rows resolves, since
`.gwrk/perspective/` does not exist, so today's payload is `domain.md` alone at about 1,500 tokens. A
380-token index is +25%, not a doubling, because the index is smaller than the ontology.

Secondary, Phase 2: one hand-written pointer line in `.gwrk/agent-context.md` naming
`.gwrk/decisions/index.md` as authoritative. That buys reach for interactive `claude` and `codex`
sessions, which read `CLAUDE.md` natively and never pass through `dispatchToAgent`. One line, no
generator, no ownership conflict.

Location note: not `docs/decisions/INDEX.md`. `source-scanner.ts:57-69` readdirs that directory and
slurps every `.md`, so an index living there would be pushed into `material.patterns` and rendered
under `## Code Patterns`, doubling the corpus in that one prompt. Keeping the derived artifact under
`.gwrk/` also keeps `docs/decisions/` purely human-authored, matching the Tier 1 constraint.

Accepted inheritance: the grounding loop is fail-open. A missing file is skipped silently, an
unreadable one prints a dim warning and dispatch continues (`agent.ts:583-598`). The index inherits
this, matching the three existing rows. `--reindex --check` is where absence becomes detectable.

### 1.7 Status: correct the corpus, add a three-value vocabulary, never filter

All three, because they answer different halves.

Correct: ADR-006 and ADR-007 read `Status: Proposed` while ADR-008 and ADR-009 both declare
`Depends on: ADR-007`, and while ADR-006 is cited from `agent-backend.ts`, `manifest.ts`,
`agent-registry.ts` and `agent.ts`. A record two later records depend on is not proposed. Two
one-line edits.

Vocabulary: `Proposed | Decided | Superseded`. Rejected `Accepted` as a synonym for the `Decided`
that nine files already use; a synonym invites drift. Rejected `Rejected` and `Deprecated` until a
real instance exists, since unused vocabulary is unmaintained vocabulary.

Never filter. The index lists every ADR with status shown. Filtering is what made stale status
dangerous: a `Status: Decided` filter drops the two records defining the dispatch path any injection
rides on. Showing status costs two tokens per row and removes a class of silent omission.

### 1.8 Supersession: carry the qualifier verbatim, derive the back-reference

Flattening misleads. ADR-002 supersedes ADR-001 "(storage mechanism only)". ADR-003 supersedes
"Partial aspects of ADR-002 §3 (Learning Loop Extraction)". A boolean on ADR-001 would tell an agent
to ignore a record whose Hard Gate Architecture is live and cited: ADR-005's header reads
`Depends on: ADR-001 (Hard Gate Architecture)`.

Index representation keeps the qualifier in the row: `Decided · superseded in part by ADR-002 (storage
mechanism only)`.

Back-references are derived, not recorded. The generator reads all nine `Supersedes` fields and emits
the inverse edge into the superseded record's row. Forward-only recording becomes sufficient, ADR-001
stops reading unqualified, and no corpus edit is needed. This is the one place derivation earns its
tokens.

### 1.9 Stable assertion ids: cite by section, register amendments, do not retrofit

Chosen: sections, numbered by the template, cited as `ADR-007 §2.4`. Section numbers survive
insertion within a section, which is what an amendment does. They break on section reordering, which
is rare and visible in a diff.

The parser extracts each record's heading tree, so `ADR-007 §2.4` resolves to a heading that exists
and `ADR-007 §9.9` reports as unresolvable.

The piece that closes the motivating defect is the amendment registry. Each record carries a final
`## Amendments` section listing every correction block it holds, keyed by the amending record's id.
`gwrk define adr --check` then verifies that every `NNN correction` cited anywhere in `src/`, `docs/`
or `specs/` exists as a registered amendment. Against today's tree it reports
`ship-orchestrator.ts:492` citing a `028 correction` that ADR-007 does not carry.

Retrofit scope is bounded to records that already carry amendments: ADR-005 (appended sections §8-§12
with `> **Amends:** §2.3, §2.4`) and ADR-007 (the inline `> **026 correction.**` at `:80`). Two files,
not nine.

Rejected: retrofitting anchors to all nine. 117,866 bytes across files of 171 to 401 lines, for a
scheme whose only current consumers are prose citations in other documents.

### 1.10 Amendment is a first-class operation

Both existing forms stay, because both are correct for different changes.

| Form | Corpus precedent | Use when |
|---|---|---|
| Inline correction blockquote | `> **026 correction.**` at ADR-007:80 | The original sentence stays true in a narrower reading |
| Appended numbered section | `## 8. Amendment: … (2026-03-16)` with `> **Amends:** §2.3, §2.4` at ADR-005:199 | The change needs its own context and consequences |

Placement resolves through the parsed heading tree, never a line number:
`gwrk define adr ADR-007 --amend --at 2.4` inserts at the end of §2.4's body. `--append-section`
appends a new top-level section numbered max+1 over existing `## N.` headings.

The command emits a full-file `WRITE_FILE`, because that is the only verb available. `IntentEngine`
executes `WRITE_FILE`, `CREATE_DIR` and `RUN_COMMAND` (`intent-engine.ts:54-119`) with no patch or
append. Two guardrails interact favourably: `wouldShrinkExistingFile`
(`workflow-runtime.ts:155-160`, `:490-501`) drops a `WRITE_FILE` shorter than what is on disk, and an
amendment always grows the file. Path containment (`intent-engine.ts:59-64`) is satisfied by a path
under the project root.

Every amendment updates the registry and regenerates the index in the same command. That is the
cascade executed rather than remembered.

W4 becomes one invocation. Its markdown is already written at
`docs/code-review-verdict-defect.md:422-431`.

### 1.11 Ratification is modelled; authorship is already settled

Agents author ADRs today. ADR-006's header reads `> **Author:** Antigravity`, and that record is
load-bearing. `gwrk-constitution/PROMPT.md:26` commissions recommendations for new ones.

The command models the transition:

- `gwrk define adr "<title>" --run` scaffolds and dispatches, writing `Status: Proposed`.
- `gwrk define adr ADR-010 --decide` flips `Proposed` to `Decided`, stamps the date, regenerates the index. No workflow, no dispatch.

`--decide` is a local file edit behind a command, so an agent can run it. Nothing in gwrk can prevent
that, and a guard claiming otherwise would be theatre. What makes ratification human is the mechanism
the repo already relies on for every `gwrk ship` run: `--decide` produces a diff, the diff lands on a
PR to `develop`, a human merges. State that, rather than implying a permission the CLI does not have.

Rejected: a `plan_proposals`-style approval table. It is dead code (`insertProposal` writes an
`updated_at` column the table lacks), hard-bound to `target_phase_id NOT NULL`, and a spine node is
forbidden by the settled constraints.

### 1.12 Injection scope: uniform

Rejected per-stage gating. The grounding loop has no scope filter, unlike `resolveEnforcementSkills`
which takes `scope: "implementation" | "review"` (`skill-runtime.ts:167`). Adding one changes the
loop's shape for a single row, and the demand analysis argues against the gate a naive reading would
build: IMPLEMENT needs decisions most and receives none today, and all four review prompts contain
zero decision references. A definition-only gate excludes exactly the two stages with the highest
demand.

At 380 tokens the uniform payload is cheaper than the branch. Revisit above ~1,000 tokens.

### 1.13 Enforcement: gate the mechanical, report the semantic

Per §0.3, `drift-detector` is not a path. Split by what each surface can decide without an agent.

`gwrk define adr --check` gates, exiting non-zero. Three mechanical assertions:

1. Every `ADR-\d+` cited in `src/`, `docs/`, `specs/` resolves to a file in `docs/decisions/`.
2. Every `NNN correction` cited resolves to a registered amendment.
3. The index hash matches the parsed corpus headers.

This belongs in CI. Assertion 2 is what catches D13.

`gwrk-analyze/PROMPT.md` reports. Add a seventh detection pass for contradiction with a recorded
decision, reading `.gwrk/decisions/index.md`. The string "ADR" appears zero times in its current 215
lines. Semantic contradiction is judgment, and `analyze` is already the definitional quality gate
with a Principal Engineer persona.

### 1.14 The audit half is a wire-up, not a new workflow

`gwrk-constitution` ships a valid manifest, with a well-formed `outputSchema` carrying
`required: [summary, intents]`, unlike `gwrk-ontology-construct`. Its PROMPT.md scope is exactly the
audit half: review `docs/decisions/` for consistency and completeness, flag drift between documented
decisions and actual code patterns, recommend new ADRs for undocumented patterns.
`grep -rn 'gwrk-constitution' src/ --include='*.ts'` returns nothing.

Wire it behind `gwrk define adr --audit`. Three prompt changes:

- Append a `<decision_context>` block naming `docs/decisions/` and the index path, mirroring how `research.ts:114` appends `<research_context>`. The prompt currently tells the agent nothing about where to write.
- Narrow line 19 ("Check that invariants from `spec.md` files match implementation"). That is scope creep for an ADR audit and duplicates `define analyze`.
- Read the index rather than readdir the corpus, so the audit and the injected payload agree.

### 1.15 The three stale lists reach the index by file read plus grounding

Constraint 3 holds and is proven twice (D6, D7). No substitution engine exists, so a `PROMPT.md`
cannot interpolate the index. Two mechanisms remain, and both are used.

A prompt reads it as a file. `gwrk-plan/PROMPT.md:102` and `gwrk-specify/PROMPT.md:29` already do
exactly this for ADR-004 ("Read `docs/decisions/ADR-004-agent-native-output.md` (required)").

A dispatch receives it via grounding. Anything through `dispatchToAgent` gets
`<architecture_decisions>` whether the prompt mentions it or not, so the prompt references the tag
rather than a placeholder.

| List | Fix |
|---|---|
| `plan-renderer.ts:33-38` stamps ADR-001..006 into every build plan | Replace the enumerated `> **Decisions:**` line with one link to the index |
| `gwrk-plan/PROMPT.md:60-64` hardcodes ADR-001..004 for the Senior Architect | Replace with the read-the-index instruction plus the `<architecture_decisions>` tag reference |
| `docs/grounding/architecture.md` anchors ADR-001..006 at `:4`, `:19-24`, `:206`, with dead `file:///Users/gonzo/…` links | Replace all three with the index reference and relative links. Highest leverage, since `gwrk-specify/PROMPT.md:25` loads this file on every specify run |

The `gwrk-plan/PROMPT.md:143-150` table has three dead pointers: `decision-forge` (`:147`),
`specify-sharpen` (`:148`), and `.gwrk/rules/seeding-governance.md` (`:145`). Neither skill exists in
`~/.gwrk/plugins/skills/`, and `.gwrk/rules/` holds only `operating-model.md` and `workspace.md`.

In scope: row `:147` alone. It routes "Architecture decisions" to a nonexistent skill, and this
feature supplies the real destination. Fixing it completes the change. Rows `:145` and `:148` are
unrelated dead pointers, filed as defects, not repaired here.

### 1.16 Slack: out of scope

Two blockers, both verified. `validSubs = ["spec","plan","tasks","tests"]` at `slack-commands.ts:695`,
with the same list at `:686`, `:778` and `slack-mentions.ts:135`. Then `resolveFeature(featureId,
context.projectRoot)` at `:710`, which throws without a `specs/` directory, before the spawn at
`:713`.

Excluded, for three reasons. `define research` and `define ontology` are already unreachable from
Slack for the same two reasons and nobody has needed them there. Routing around `resolveFeature`
means a per-subcommand branch on whether the positional is a feature, adding a fourth hardcoded copy
of `validSubs` to keep in sync. And ratification (§1.11) needs a diff and a PR review, for which
Slack has no channel.

Filed instead: the four-copy `validSubs` duplication, for a Slack-surface initiative where one fix
covers `research`, `ontology` and `adr` together.

### 1.17 Numbering: max+1, with the research allocator's three flaws fixed

`ADR-NNN`, zero-padded to three, max+1 over `docs/decisions/` entries matching `/^ADR-(\d{3})-/`.
Same shape as `research-scaffold.ts:66-75`, correcting what that allocator gets wrong:

| Flaw | Where | Fix |
|---|---|---|
| Filter runs on raw readdir with no type check | `research-scaffold.ts:49` | Filter on `.md` suffix and the `ADR-\d{3}-` pattern |
| No existence check before write, so a same-number different-slug collision silently creates a sibling | `research-scaffold.ts:81` | Fail with the conflicting path if `ADR-NNN-*.md` exists at the computed number. The corpus is contiguous 001-009 and stays so |
| No project-root discovery: joins `process.cwd()` with literal `"docs","research"` | `research-scaffold.ts:42`, `:121` | Walk parents for `.gwrkrc.json`, as `init.ts` does, so the command works from a subdirectory |

No locking, matching research and specs. Two concurrent runs both compute 010, and the existence
check makes the second fail loudly instead of writing a duplicate. A lockfile is out of proportion to
a human-paced command.

`config.ts:86-95` declares `project.architecture.decisions` and nothing reads it. Read it, defaulting
to `docs/decisions`. One `loadConfig` call turns a declared-but-dead seam into the configuration
point.

---

## 2. Phases

### Phase 1: Author

Ships alone. `gwrk define adr` writes a correctly-shaped record at the right number, and the nine
existing files become parseable.

- `adrCommandHandler` plus an exported `Command`, registered in `define.ts`
- `AdrScaffolder`: numbering, collision failure, project-root discovery
- `adr-parser`: blockquote header, heading tree, `Supersedes`/`Depends on`
- The template (§4)
- Corpus reconciliation (§4.2), including the W4 correction block as a hand edit
- Builtin workflow `gwrk-adr-record` for `--run`

No grounding change, no prompt change, no index. Value without Phase 2: the corpus stops drifting in
shape, and the next decision gets written instead of remembered.

### Phase 2: Index and inject

- `adr-index` generator, `.gwrk/decisions/index.md`, content hash
- `--reindex`, `--reindex --check`
- Fourth `groundingFiles` row
- `> **Constraint:**` field added to all nine records
- The three stale lists, plus `gwrk-plan/PROMPT.md:147`
- `source-scanner` gains `material.decisions`, ending the `## Code Patterns` mislabel
- One pointer line in `.gwrk/agent-context.md`
- `gwrk init` generates the index when `docs/decisions/` is non-empty

### Phase 3: Amend and check

- `--amend --at`, `--append-section`, `--decide`
- `## Amendments` registry, retrofitted to ADR-005 and ADR-007
- `--check`, wired into CI
- W5: the `028-review-finding-liveness` spec record

Closes D13. This is the phase that pays back the motivating defect, which is the honest cost of
front-loading shippability: Phase 1 delivers first, Phase 3 delivers the reason.

W4 does not have to wait. The ADR-007 correction block is a one-file hand edit in Phase 1, using
markdown that already exists.

### Phase 4: Audit

- Wire `gwrk-constitution` behind `--audit`, with the three prompt changes
- Seventh detection pass in `gwrk-analyze/PROMPT.md`

---

## 3. Files

### gwrk core

| Path | Phase | Change |
|---|---|---|
| `src/commands/adr.ts` | 1 | New. Handler plus exported `Command`. Export from its own module, per constraint 5 |
| `src/commands/define.ts` | 1 | Register `adrCommand` alongside `researchCommand` at `:199-215`. Add `adr` to the `Examples:` block at `:57-64` |
| `src/engine/adr-scaffold.ts` | 1 | New. Numbering, collision, template write |
| `src/engine/adr-parser.ts` | 1 | New. Blockquote header, heading tree, relations |
| `src/engine/adr-index.ts` | 2 | New. Index generation, back-reference derivation, hash |
| `src/engine/adr-check.ts` | 3 | New. Citation and amendment resolution |
| `src/engine/adr-amend.ts` | 3 | New. Section-addressed insertion |
| `src/utils/agent.ts` | 2 | Fourth entry in `groundingFiles` at `:567-581` |
| `src/engine/source-scanner.ts` | 2 | `material.decisions` field; stop pushing ADRs into `material.patterns` at `:57-69` |
| `src/commands/define-ontology.ts` | 2 | Render `material.decisions` under its own heading, not `## Code Patterns` at `:48-49` |
| `src/engine/plan-renderer.ts` | 2 | Index link replaces the ADR enumeration at `:38` |
| `src/commands/init.ts` | 2 | Generate the index when `docs/decisions/` is non-empty, near the scaffold block at `:429-441` |
| `src/utils/config.ts` | 2 | No schema change. Read `project.architecture.decisions` (`:86-95`) in the scaffolder |
| `src/engine/ship-orchestrator.ts` | 3 | Correct the `028 correction` citation at `:492` to the registered amendment address |

### Builtin plugins

| Path | Phase | Change |
|---|---|---|
| `src/plugins/builtins/workflows/gwrk-adr-record/manifest.yaml` | 1 | New. `name: gwrk-adr-record`, version `1.0.0`, `outputSchema` with `required: [summary, intents]` |
| `src/plugins/builtins/workflows/gwrk-adr-record/PROMPT.md` | 1 | New. No placeholders (constraint 3) |
| `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` | 2 | Replace `:60-64` enumeration. Repair `:147` |
| `src/plugins/builtins/workflows/gwrk-specify/PROMPT.md` | 2 | Index reference at `:25-29` |
| `src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` | 4 | Seventh detection pass |
| `src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` | 4 | Three changes per §1.14 |

Shipping a builtin needs two files and `npm run build`; postbuild copies the tree. Real `gwrk` runs
`dist/`, so the build is not optional.

### Docs and corpus

| Path | Phase | Change |
|---|---|---|
| `docs/decisions/ADR-001-task-tracking.md` | 1 | H1 style; duplicate `## 7.` heading |
| `docs/decisions/ADR-002-sqlite-execution-ledger.md` | 1 | H1 style; relative `Supersedes` link |
| `docs/decisions/ADR-006-plugin-agent-backends.md` | 1 | `Status: Proposed` → `Decided` |
| `docs/decisions/ADR-007-single-dispatch-path.md` | 1 | Status; W4 correction block |
| `docs/decisions/ADR-00{1..9}-*.md` | 2 | `> **Constraint:**` field |
| `docs/decisions/ADR-005`, `ADR-007` | 3 | `## Amendments` registry |
| `docs/decisions/ADR-010-decision-records.md` | 1 | New. This feature's own record, written by the command it ships |
| `docs/grounding/architecture.md` | 2 | Three ADR anchors; dead `file:///` links |
| `.gwrk/agent-context.md` | 2 | One pointer line |

---

## 4. Template and migration

### 4.1 The template the feature scaffolds

Written to AGENTS.md §7: bare headings, active voice, no em-dash glosses, one idea in one place. It is
the enforcement point for every ADR gwrk writes.

```markdown
# ADR-NNN: <Title>

> **Status:** Proposed · **Date:** YYYY-MM-DD
> **Decision:** <One sentence. What was chosen.>
> **Constraint:** <One sentence, imperative. What may not be done. MUST or MUST NOT.>
> **Depends on:** ADR-NNN (<scope>)
> **Supersedes:** ADR-NNN (<qualifier, if partial>)
> **Author:** <name> · **Decision Scope:** <subsystem>

---

## 1. Context

What forced the decision. The state of the code that made it necessary, with file:line.

## 2. Decision

### 2.1 <Assertion>

### 2.2 <Assertion>

## 3. Decision Record

| | |
|---|---|
| Position | <the choice> |
| Confidence | <High, Medium, Low> and what would change it |
| Reversibility | <cost to undo> |
| Risk | <what breaks if this is wrong> |

## 4. Alternatives Rejected

| Option | Why not |
|---|---|

## 5. Impact on Existing Code

| Path | Change |
|---|---|

## 6. Consequences

## 7. References

## 8. Amendments

| Amendment | Amends | Date | Source |
|---|---|---|---|
```

Numbered sections give §1.9 its addressing. `## 8. Amendments` starts empty and is the registry
`--check` reads. The `Decision Record` table follows 004-009 rather than inventing a fourth shape.

### 4.2 Migration: reconciliation, not conversion

The metadata answer keeps the blockquote, so no file is rewritten. Seven edits across six files.

| # | Edit | Files | Phase |
|---|---|---|---|
| 1 | H1 → `# ADR-00N: <title>` | 001, 002 | 1 |
| 2 | `Status: Proposed` → `Decided` | 006, 007 | 1 |
| 3 | Relative `Supersedes` link, dropping `file:///Users/gonzo/…` | 002 | 1 |
| 4 | Deduplicate the two `## 7.` headings so section addressing is unambiguous | 001 | 1 |
| 5 | Apply the W4 correction block from `docs/code-review-verdict-defect.md:422-431` | 007 | 1 |
| 6 | Add `> **Constraint:**`, lifted from each `Decision Record` block | all nine | 2 |
| 7 | Add `## Amendments` listing existing amendments | 005, 007 | 3 |

Edits 1-5 are mechanical and reviewable in one diff. Edit 6 is nine judgment calls, which is why it
sits in the phase that consumes the field. Nothing in the corpus is deleted or reordered.

---

## 5. Test surface

### Existing suites

| File | Change |
|---|---|
| `src/cli.ux.test.ts` | Add `"define adr"` to `commandsWithExamples` at `:43-55`, or the `Examples:` invariant goes unenforced |
| `src/cli.e2e.test.ts` | Assert `adr` in `define --help` at `:75-88`. It passes untouched, so asserting it is the deliberate move |
| `src/cli.option-collisions.test.ts` | **No change.** See below |
| `src/cli.consistency.test.ts` | No change. Its feature-argument list is 10 hardcoded paths and the ADR positional is not a feature |
| `src/engine/drift-detector.test.ts` | No change. Per §0.3 nothing is added to `getDriftArtifacts()` |
| `src/commands/define-ontology.test.ts` | No change |

The collision test stays untouched by design. `define adr` declares neither `--refs` nor `--dry-run`,
so the nine-entry baseline (eight `HANDLED` plus one `VERIFIED_BENIGN` at `:31-51`) holds and both
assertions pass. `--refs` is meaningless for an ADR, and the dry-run affordance ships as `--print`
instead, avoiding the parent's `--dry-run`.

Avoidance beats allowlisting here for a specific reason. Constraint 6 is exact: the test asserts set
equality of discovered collisions and never that `withParentFlags` is called, so an allowlist entry
alone turns CI green on a broken flag. That is how D1 shipped. A flag that cannot collide cannot
repeat it.

### New files

| File | Shape |
|---|---|
| `src/commands/adr.test.ts` | Handler-level, per `research.test.ts`: import `adrCommandHandler`, mock the engine, assert the returned string. Keep `console.log` in the action |
| `src/commands/adr-dispatch.test.ts` | Per `research-dispatch.test.ts`: mock `WorkflowRuntime`, `node:fs/promises`, `loadConfig`, `resolveModelForTask`. Assert `executeWorkflow` receives `gwrk-adr-record`, an input containing the title, `{agent, model}`, and `projectRoot`. Assert the runtime is never constructed without `--run` |
| `src/engine/adr-scaffold.test.ts` | Mock `node:fs/promises` wholesale, assert `mkdir`/`writeFile` arguments, max+1 numbering, loud failure on same-number collision |
| `src/engine/adr-parser.test.ts` | Fixtures reproducing all four documented header inconsistencies |
| `src/engine/adr-index.test.ts` | Row generation, derived back-references, qualifier preservation, hash stability |
| `src/engine/adr-check.test.ts` | Citation resolution, with the `028 correction` case as a fixture |
| `src/utils/agent.grounding-decisions.test.ts` | `<architecture_decisions>` injected when the index exists, skipped silently when absent |

`adr-dispatch.test.ts` asserting `projectRoot` is the one deliberate divergence from the research
precedent. `define research --run` passes no `projectRoot`, so `executeWorkflow` falls back to a
default `PluginLoader` with no `projectDir` (`workflow-runtime.ts:298-303`) and project-local
overrides are invisible. Passing it does not weaken constraint 4, which still requires the workflow
to ship as a builtin, and it removes the asymmetry.

`adr-parser.test.ts` uses fixtures rather than reading `docs/decisions/`. A suite that reads the live
corpus breaks when ADR-010 lands, and every test retries once (`vitest.config.ts:38`), so a
corpus-coupled failure would surface as flake.

### Harness constraints

- Test titles must embed an `FR-`, `US-` or `TR-` id. `scripts/dev/test-report.ts` extracts the first token and maps it through the spec's `gap-matrix.md`.
- The pre-commit hook is not installed in this clone. `.git/hooks/pre-commit` is absent and `core.hooksPath` is unset. Add the three-line MPL header to every new `.ts` file by hand and run `npm run build` manually.
- `tsconfig.json:15` excludes `**/*.test.ts` and biome ignores most test globs, so type and lint errors in the new test files are invisible to both gates. Lint also runs `continue-on-error` in CI.
- Keep the suite hermetic (no git, no live corpus) and no `GWRK_SKIP_INTEGRATION` quarantine entry is needed.

---

## 6. Defects

### Must fix for this feature to work

| # | Why |
|---|---|
| D3 | Sharpest blocker. `specs/` ends at `027`, so the next scaffold takes `028`. W5 must be `028-review-finding-liveness`, and if this feature's spec is scaffolded first it takes that number, leaving `ship-orchestrator.ts:492`'s citation resolving to the wrong record. D3 blocks the workaround: both ternary branches at `specify.ts:125-127` return `undefined`, so `--number` cannot choose, and a numeric prefix gets slugified into the name, producing `specs/028-029-decision-records/`. Fix D3, or scaffold W5 before this feature's spec |
| Scanner mislabel | Not numbered in the survey. `source-scanner.ts:57-69` pushes all nine ADRs into `material.patterns`, rendered as `## Code Patterns` (`define-ontology.ts:48-49`). Phase 2 replaces the corpus with the index on that path, so the field split is part of the change |
| D9, D10 | These are the stale lists of §1.15. Fixing them is the feature's reach |
| D13 | The motivating defect. Phase 3 (`--check`), or Phase 1 as a hand edit |

### Affects the workflow that builds this feature, not its runtime

| # | Note |
|---|---|
| D1 | `--refs` is discarded on `define research`. `research.ts:172` declares its own `--refs`, the handler consumes `args.refs` at `:96-111`, and the value binds to the parent at `define.ts:66` instead. The R012 brief works around it by instructing a file read rather than relying on `--refs`. Fix it so the R012 to spec to plan chain is trustworthy, not because the ADR feature needs it |
| D2 | Fix with D1. `cli.option-collisions.test.ts:39` lists `define research --refs` under `HANDLED`, documented as handled by `withParentFlags`, which `research.ts` never calls |

### Separate

| # | Note |
|---|---|
| D4 | `getHighestFromDb()` hardcoded `return 0`. Adjacent to D3 but not blocking |
| D5 | `scaffoldFeature` copies a nonexistent `specs/spec-template.md` |
| D6, D7 | Placeholder substitution. This design uses no placeholders, per constraint 3 |
| D8 | `plan_proposals` write paths throw. Relevant only to the rejected approval-table option |
| D11 | `source-scanner` ignores the 53 KB `docs/grounding/architecture.md`. Same file, different arm (`:42-55`) from the decisions arm this feature touches. Note that `init.ts:429-441` creates `docs/architecture/` as a directory while the scanner looks for `docs/architecture.md` |
| D12 | `define research` skips `withSignal`, dropping the `[exit:N \| Xs]` line ADR-004 requires. `define adr` must use `withSignal` and not copy this |

### Filed, not fixed

- `gwrk-plan/PROMPT.md:145` (`.gwrk/rules/seeding-governance.md`) and `:148` (`specify-sharpen`), both dead pointers unrelated to decisions.
- Four hardcoded copies of `validSubs` (`slack-commands.ts:686`, `:695`, `:778`, `slack-mentions.ts:135`).
- `gwrk-cascade-sync` is unwired (§0.5).
- `.gwrk/rules/*.md` is read by no live code path.
