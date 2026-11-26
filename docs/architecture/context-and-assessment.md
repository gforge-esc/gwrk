# Architecture context and assessment

`gwrk init` installs a desired architecture without calling a language model. `gwrk assess` uses the configured definition agent. It inspects code and proposes ordered feature specs. Blocked: none.

## Initialize a project

```bash
gwrk init --architecture hexagonal-functional --principles functional-core,clean-code,tdd
```

The wizard preserves existing choices. Supported built-in targets include `hexagonal-functional`, `layered` and `clean`. A custom target uses project-owned decision records for concrete rules.

Use `--language` and `--framework` to select context bindings explicitly. Otherwise setup uses the detected or existing stack. Initialization does not rewrite source or enable architecture checks.

For an existing project with working machine and agent settings:

```bash
gwrk init --context-only --architecture hexagonal-functional
```

This path preserves personal agent configuration and machine registration. It also works in a fresh directory. Use full init when machine provisioning is needed.

## Generated files

| File | Purpose |
|---|---|
| `.gwrkrc.json` | Tracked design selection |
| `.gwrk/architecture.md` | Derived target context |
| `.gwrk/context-manifest.json` | Generated-file hashes and decision identity |
| Configured decision corpus | Proposed target decision |
| `.gwrk/decisions/index.md` | Derived decision index |
| `AGENTS.md` | Managed context references |
| `CLAUDE.md` | Managed context references |
| `GEMINI.md` | Managed context references |
| `.gwrk/plugins/gwrk/` | Shared assessment skill and client manifests |
| `.gwrk/.claude-plugin/marketplace.json` | Local marketplace catalog |

New decisions remain Proposed. Existing Decided records retain authority. Adopting a target does not establish current conformance.

Re-init preserves authored decisions. It reports edits to managed generated content as conflicts. Preserve desired edits in project decisions before regenerating context. Inspect any conflict before assessment.

## Run an assessment

```bash
gwrk assess
gwrk assess --output docs/architecture/assessments/migration-review --refs docs/research/prior-gap-map.md
```

The default output directory is unique per run. The command refuses an existing directory. `--backend` and `--model` override the configured definition agent for this run.

Use `gwrk assess --print` to inspect the input without an agent call. An assessment requires initialized target context and a parseable decision corpus.

| Artifact | Contents |
|---|---|
| `report.md` | Findings and proposed feature sequence |
| `assessment.json` | Validated structured assessment |
| `target.md` | Target supplied to the assessment |
| `provenance.json` | Revision and inspected-source hashes |
| `reference-1.md` | Preserved first supplied reference |
| `specs/*/spec.md` | Ordered proposed feature specifications |

Each finding needs a source path and line. Each feature covers findings and declares dependencies. A supplied “Gaps and consequences” table requires explicit reconciliation of every row. The command rejects invalid structure or unresolved evidence locations.

The report remains an assessment of inspected scope. It is not a claim that all architecture rules hold. Review proposed specs before adopting them into the project build plan.

## Recover a recorded response

If an Antigravity transport parsing failure leaves a completed stream, recover it without another model call:

```bash
gwrk assess --from-log .runs/completed-response.jsonl --output docs/architecture/assessments/recovered
```

Recovery requires a verified successful terminal status from the adapter. It applies the same schema and evidence checks. It rejects mutation intents. `--target-snapshot` supplies the original target file when context changed after the run. The output records the stream hash and recovery origin.

## Use the skill in another client

The generated package follows the shared marketplace layout used in `dgonzo-plugins`. Claude and Codex use the same skill directory.

For Claude Code, register the local marketplace and install its plugin:

```bash
claude plugin marketplace add ./.gwrk
claude plugin install gwrk@gwrk
```

For a Codex client with plugin support:

```bash
codex plugin marketplace add ./.gwrk
codex plugin add gwrk@gwrk
```

Restart the client session after installation. Select `gwrk-assess` using the client's skill selector. Standalone skills can also load `.gwrk/plugins/gwrk/skills/gwrk-assess/SKILL.md` directly.

For Antigravity:

```bash
agy plugin install ./.gwrk/plugins/gwrk
```

These commands are optional client registration steps. Initialization generates the package without changing account-wide plugin settings. Client trust and discovery still depend on the installed client version.

The standalone skill assesses code in the chosen client. The gwrk command uses the same method through WorkflowRuntime. Neither route implements repairs.

## Verify setup

```bash
pnpm build
python3 scripts/architecture-context-uat.py
```

The acceptance script exercises the compiled CLI in temporary projects. It checks stable output and preservation of existing work. Agent executable traps prove that setup and preview make no agent calls.
