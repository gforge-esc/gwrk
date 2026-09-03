# Contract: `gwrk define adr` Command Surface

**Feature**: 029 Decision Records | **Spec**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

CLI surface, agent-native compliance, and the three integration seams this feature touches outside its
own modules.

---

## 1. Registration and handler — Phase 2 (FR-001, FR-008)

### `src/commands/adr.ts`

```ts
export interface AdrArgs {
  /** A title ("Decision Records") or an ADR-NNN id. Absent for --reindex / --check / --audit. */
  target?: string;
  print?: boolean;
  run?: boolean;
  reindex?: boolean;
  check?: boolean;
  amend?: boolean;
  at?: string;
  appendSection?: boolean;
  decide?: boolean;
  audit?: boolean;
  agent?: string;
  model?: string;
  format?: "text" | "json";
}

/** Handler-level, per `research.ts`. Returns the string the action logs.
 *  `console.log` stays in the action so the handler is unit-testable (TR-003). */
export async function adrCommandHandler(args: AdrArgs): Promise<string>;

/** Exported commander Command, registered on `defineCommand` alongside `researchCommand`. */
export const adrCommand: Command;
```

**Registration** (`src/commands/define.ts`): `defineCommand.addCommand(adrCommand)`, not hidden — `adr`
is absent from `cli.e2e.test.ts`'s `hidden` list `["analyze","specify","generate","implement","ship"]`,
so it appears in `define --help` (TR-010). `adr` is added to the parent `define` `Examples:` block, and
the subcommand carries its own `Examples:` block (TR-009).

**Signal wrapper (ADR-004).** The action **MUST** wrap its work in `withSignal("define adr", …)` so the
`[exit:N | Xs]` line is emitted on stderr. D12 records that `define research` skips this; FR-001
explicitly forbids copying that omission. `CommandError(message, code)` carries the exit code.

**Flags NOT declared (TC-013, FR-008).** Neither `--refs` nor `--dry-run`. `--refs` is meaningless for
an ADR; the dry-run affordance is `--print`. This keeps the nine-entry baseline in
`cli.option-collisions.test.ts:31-51` (eight `HANDLED` plus one `VERIFIED_BENIGN`) intact, and **no
allowlist entry may be added** — that test asserts set equality of discovered collisions and never that
`withParentFlags` is called, so an allowlist entry alone turns CI green on a broken flag. That is exactly
how D1 shipped.

---

## 2. Invocation contract (ADR-004 command classification)

| Invocation | Type | Exit 0 | Exit 1 | `--format json` | Phase |
|---|---|---|---|---|---|
| `gwrk define adr "<title>"` | generator | record written, index regenerated | collision, no project root, empty title | N/A — writes a file; path on stdout | 2 (index from 5) |
| `gwrk define adr "<title>" --run` | generator (dispatching) | workflow returned `{summary, intents}` | workflow missing, schema violation, no backend | N/A | 3 |
| `gwrk define adr --print` | query | template printed to stdout, nothing written | no project root | N/A — emits the markdown template | 2 |
| `gwrk define adr --reindex` | generator | index written | unparseable header | N/A | 5 |
| `gwrk define adr --reindex --check` | verifier | hash matches | stale, absent, unparseable | supported | 5 |
| `gwrk define adr <id> --amend --at <s>` | mutator | inserted, registered, reindexed | unresolvable address or id, would shrink | N/A | 8 |
| `gwrk define adr <id> --append-section` | mutator | appended, registered, reindexed | unresolvable id | N/A | 8 |
| `gwrk define adr <id> --decide` | mutator | status flipped, index regenerated | already `Decided`, `Superseded`, unknown id | N/A | 8 |
| `gwrk define adr --check` | verifier | all three assertions pass | any assertion fails, one finding per line | supported | 10 |
| `gwrk define adr --audit` | generator (dispatching) | report returned | workflow missing, no backend | N/A | 11 |

Every failure message is **error-as-navigation**: it names the offending path or id and, where one
exists, the corrective command. Full message text is contracted in
[`adr-engine.md`](./adr-engine.md) §3, §4, §5, §6.

`--format json` is a **verifier** affordance: the `{ok, findings}` shape below is the only JSON shape
this contract defines, and `--print` is classified a query, not a verifier. `--print` therefore emits the
markdown template on stdout and declares no `--format`; the flag arrives with the first verifier
invocation (`--reindex --check`, Phase 5). Phase 2 declares `--print` only, per plan.md Phase 2 > Files
and TR-003.

**`--format json` shape** (verifier invocations):

```json
{ "ok": false, "findings": [ { "file": "src/engine/ship-orchestrator.ts", "line": 492, "assertion": 2, "message": "cites a '028 correction' not registered in ADR-007's ## Amendments" } ] }
```

**Executed cascade (FR-026).** Every mutating invocation — scaffold write, amendment, appended section,
`--decide` — updates the amendment registry where applicable **and** regenerates the index in the same
command. The cascade is executed, not remembered.

---

## 3. Dispatch contract — Phases 3 and 11 (FR-007, FR-027)

All dispatch goes through `WorkflowRuntime.executeWorkflow` — never a raw spawn (ADR-007).

### `--run` → `gwrk-adr-record` (Phase 3)

```ts
const config = loadConfig(process.cwd());
const backend = config.agents.define;
const model = resolveModelForTask("define", backend, process.cwd());
const runtime = new WorkflowRuntime();
await runtime.executeWorkflow("gwrk-adr-record", workflowInput, {
  agent: backend,
  model,
  projectRoot,           // deliberate divergence from `define research --run`
});
```

`workflowInput` carries the title and an appended `<decision_context>` block naming the target path.

**`projectRoot` is passed deliberately.** `define research --run` omits it and so falls back to a default
`PluginLoader` with no `projectDir`, making project-local overrides invisible. Asserted by TR-004.

**Without `--run`, `WorkflowRuntime` is never constructed** — asserted by TR-004.

### Builtin manifest (`gwrk-adr-record/manifest.yaml`)

```yaml
type: workflow
name: gwrk-adr-record
version: 1.0.0
description: Draft an architecture decision record from a title and target path
outputSchema:
  type: object
  properties:
    summary: { type: string }
    intents:
      type: array
      items:
        type: object
        properties:
          action: { type: string, enum: [WRITE_FILE, CREATE_DIR, RUN_COMMAND] }
          filePath: { type: string }
          content: { type: string }
          dirPath: { type: string }
          command: { type: string }
        required: [action]
  required: [summary, intents]
```

`PROMPT.md` **MUST** carry no `{{PLACEHOLDER}}` token (TC-008 — no substitution engine exists, proven
twice as D6 and D7). Both files must reach `dist/` via `pnpm run build` + `postbuild` (TC-012).

| Condition | stderr contains | Exit |
|---|---|---|
| `gwrk-adr-record` not resolvable by the loader | `Workflow not found: gwrk-adr-record. Run: npm run build` | 1 |
| Output fails `outputSchema` | `gwrk-adr-record returned no valid {summary, intents}` | 1 |
| `--run` with no configured backend | `No agent backend available. Run: gwrk plugin list agents` | 1 |

### `--audit` → `gwrk-constitution` (Phase 11)

Dispatches the already-shipped builtin — valid manifest, `required: [summary, intents]`, referenced from
**no TypeScript today** — narrowed to the ADR corpus, with an appended `<decision_context>` block naming
`docs/decisions/` and `.gwrk/decisions/index.md`, mirroring how `research.ts:114` appends
`<research_context>`. `gwrk-adr-record` is the **only** new workflow this feature adds (SC-010).

---

## 4. Grounding-injection contract — Phase 6 (FR-013)

### `src/utils/agent.ts`

A **fourth** entry on the `groundingFiles` array at `:567-581`:

```ts
{ path: path.join(workDir, ".gwrk/decisions/index.md"), tag: "architecture_decisions" },
```

| Requirement | Behaviour |
|---|---|
| Uniform (TC-009) | No scope parameter, no stage filter. Unlike `resolveEnforcementSkills(projectRoot, scope, profile)`. IMPLEMENT and all four review stages receive it — they carry zero decision references today (SC-004) |
| Fail-open (TC-016) | Missing file → skipped silently, no warning. Unreadable → dim warning, dispatch continues. Exactly as the three existing rows behave |
| Detection | Absence becomes detectable via `--reindex --check`, **not** at dispatch |
| Payload | `<architecture_decisions>\n${content}\n</architecture_decisions>` |
| Array shape | Exactly four entries; asserted by TR-008 to prevent a scope filter being introduced later |

`groundingFiles` is a local `Array<{path, tag}>`, not an exported type — a fourth entry changes no
signature.

### `src/engine/source-scanner.ts` (FR-015)

```ts
// additive field on the material type; `material.patterns` survives with a narrower
// population, so every other reader keeps compiling
material.decisions: string[]
```

The readdir at `:57-69` **MUST** stop pushing ADRs into `material.patterns`, and
`define-ontology.ts:48-49` **MUST** render `material.decisions` under its own heading rather than
`## Code Patterns`. Nine architecture decisions arriving at the ontology workflow labelled as code
patterns is the mislabelling this fixes. On this path the **index replaces the corpus**.

---

## 5. Citation-surface contract — Phase 7 (FR-016, FR-018)

Four pointers become index references. Because no substitution engine exists (TC-008), the index reaches
a prompt by **file read** and reaches a dispatch by the **`<architecture_decisions>` tag** — the two
mechanisms `gwrk-plan/PROMPT.md:102` and `gwrk-specify/PROMPT.md:29` already use for ADR-004.

| Site | Today | Required |
|---|---|---|
| `src/engine/plan-renderer.ts:38` | `> **Decisions:** [ADR-001](…), … [ADR-006](…)` — stops at ADR-006 | One link to `.gwrk/decisions/index.md`. **Header only** — no phase, task or `Requirements Addressed:` grammar is touched (023 compatibility, verified by TR-012) |
| `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md:60-65` | Enumeration stopping at ADR-004 | Read-the-index instruction plus an `<architecture_decisions>` reference |
| `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md:147` | Routes "Architecture decisions" to `~/.gwrk/plugins/skills/decision-forge/SKILL.md` — **a skill that does not exist** | Route to `.gwrk/decisions/index.md`. `:145` and `:148` are separate dead pointers, filed not fixed |
| `src/plugins/builtins/workflows/gwrk-specify/PROMPT.md` | Architecture-reference list without the index | Add the index. Highest leverage: `:25` loads `architecture.md` on every specify run |
| `docs/grounding/architecture.md` `:4`, `:19-24`, `:206` | Enumeration with dead `file:///Users/gonzo/…` links | Index reference plus relative links |
| `.gwrk/agent-context.md` | Six hand-written lines, no index | **Exactly one** hand-written pointer line naming `.gwrk/decisions/index.md` as authoritative |

**Why one hand-written line and no generator (FR-018).** `syncGovernance` replaces the whole marker
block with the whole file, so a generated index there would either own the file and destroy the six
hand-written lines, or require a composer — the ownership ambiguity that rots. The line buys reach for
interactive `claude` and `codex` sessions, which read `CLAUDE.md` natively and never pass through
`dispatchToAgent`.

---

## 6. Prompt contract — Phase 11 (FR-027, FR-028)

| File | Required change |
|---|---|
| `gwrk-constitution/PROMPT.md` | Append-time `<decision_context>` naming `docs/decisions/` and the index path (the prompt currently says nothing about where to write); **narrow** the `:19` line "Check that invariants from `spec.md` files match implementation" — scope creep for an ADR audit, duplicating `define analyze`; read the index rather than readdir the corpus, so the audit and the injected payload agree |
| `gwrk-analyze/PROMPT.md` | A **seventh** detection pass — passes A–F exist today at `:69-161`, and the string "ADR" appears **zero** times in its 215 lines. `#### G. Recorded Decision Contradiction`, reading `.gwrk/decisions/index.md`. Semantic contradiction is judgment, so it **reports rather than gates**; `analyze` is already the definitional quality gate with a Principal Engineer persona |

Both files must reach `dist/` via `pnpm run build` + `postbuild` (TC-012). Real `gwrk` runs compiled
`dist/`, so a source-only prompt change is unverified.
