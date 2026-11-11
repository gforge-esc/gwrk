# Model qualification and routing

Give each agent plugin a way to discover models. Use one gwrk workflow to test candidates and pin the best qualified model for each job. Blocked: none.

## Current routing

| Path | Current behavior | Preparation gap |
|---|---|---|
| Built-in agent manifests | Static default, fast and review labels | No account-specific qualification |
| Local registry | Antigravity has an empty model list | Definition can inherit the CLI default |
| Definition | Most commands share the define role | Tasks drops the resolved model |
| Direct implementation | The command resolves only the backend | Fast model selection can disappear |
| Ship | Server selector picks one model for the phase | Explicit backend override skips model selection |
| Adapter execution | Antigravity and Claude pass effort | Codex does not map effort |
| Run evidence | Some manifests record a selected model | No common requested and observed identity |

The three built-in manifests list Argon, Flash and Opus for Antigravity. Claude uses rolling Sonnet and Opus aliases. Codex lists older GPT-5 Codex models absent from this account's current picker. Editing these manifests alone would leave the current project registry and call paths unchanged. [Built-in agents](../../src/plugins/builtins/agents) · [Definition resolver](../../src/utils/resolve-agent.ts) · [Tasks command](../../src/commands/tasks-generate.ts) · [Implement command](../../src/commands/implement.ts) · [Ship command](../../src/commands/ship.ts)

The definition resolver returns the model's registry name. The server can use its separate invocation flag. The shared selector can also cross tiers when the preferred tier is unavailable. Unify selection and pass one typed model choice through WorkflowRuntime. Keep provider flags inside adapters. This extends the self-assessment's [Unified routing and prompt delivery](../architecture/assessments/2026-11-11-self-assessment/specs/03-unified-agent-dispatch-and-stream-contracts/spec.md).

## Discovery by plugin

| Plugin | Discovery path | Qualification detail |
|---|---|---|
| Antigravity | Authenticated `agy models` | Exact slug includes effort where offered |
| Codex | App Server `model/list` over standard input and output | Paginate and keep supported effort values |
| Claude Code | Agent SDK `supportedModels()` under matching auth | Exact provider identifier and effort |
| Cursor | `agent models` or the installed alias with `--list-models` | Exclude automatic selection from pins |
| OpenCode | `opencode models` under project configuration | Provider-qualified ID and variant |
| Aider | `aider --list-models <filter>` | Candidate inventory plus authenticated probe |
| Goose | Configured provider catalog or explicit candidate list | Add per-run model forwarding first |

Antigravity 1.5.5 listed Gemini 4 Carbon, Gemini 4 Argon and Gemini 3.8 Flash. It also listed Claude Opus 5.5 and Sonnet 5.5 through the signed-in account. Treat those Claude entries as separate routes from native Claude Code. Google ended Gemini CLI access for consumer plans on June 18, 2026. Eligible enterprise and paid API routes retain access. Use `agy` for current Google qualification. The gwrk registry removes its standalone `gemini` adapter. Use the registry migration instructions for existing installations. [Antigravity headless mode](https://antigravity.google/docs/cli/headless/) · [Google transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) · [Antigravity migration guide](https://antigravity.google/docs/cli/gcli-migration)

[Plugin registry](https://github.com/gforge-esc/gwrk-plugins)

## Execution clients

Use Antigravity CLI for Google model qualification. Use native Claude CLI to qualify Claude Code routes. Qualify Codex through the Codex CLI. Interactive apps and editor extensions can share the project guidance.

## Catalog observations

Codex 0.167.0-alpha.4.1 returned GPT-6.1 Sol and Terra. It also listed GPT-6 Astra, Sol and Luna. The visible list also had GPT-5.6 Sol, Terra and Luna. GPT-6.1 Sol was the account default. Discovery also returned hidden entries. Omit those from automatic candidate selection. [Codex App Server](https://learn.chatgpt.com/docs/app-server)

Interactive Claude Code listed available models through `/model`. In the Codex task shell, Claude Code 2.1.322 reported no active login. A tool-free headless probe failed because its OAuth session expired and could not refresh. The cause of the difference between sessions remains unverified.

Use the interactive picker as a discovery fallback. Run Agent SDK discovery under the same account and launch environment as gwrk. Use an exact-model headless probe to qualify the route. Repeat the probe on each intended runner. Capture the effective model from runtime evidence where available. [Claude Code model configuration](https://code.claude.com/docs/en/model-config) · [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript)

Cursor was present. OpenCode, Aider and Goose were absent from the shell. These external adapters have documented discovery paths. Verify them when each backend is enabled. Goose currently ignores `task.model`. [Cursor CLI model list](https://cursor.com/changelog/cli-jan-08-2026) · [OpenCode commands](https://opencode.ai/docs/cli/commands/) · [Aider model discovery](https://aider.chat/docs/llms/other) · [Goose providers](https://github.com/aaif-goose/goose/blob/main/documentation/docs/getting-started/providers.md) · [External agent adapters](https://github.com/gforge-esc/gwrk-plugins/tree/main/agents)

## Roles and first candidates

| Role | What it must deliver | Initial candidates |
|---|---|---|
| Define spec and plan | Grounded, complete design and executable plan | Carbon High, Argon High, Astra, native Opus |
| Define tests and tasks | Test-first gates and traceable task contracts | Qualified definition route |
| Implement | Passing gates from a fixed plan | Flash Medium or High, Terra, Luna, Sonnet or Haiku |
| Review and diagnose | Evidence-backed findings and sound repair advice | Qualified frontier route with independent review |
| Judge promotion | Blind comparison with evidence for each verdict | Two pinned frontier models from different families and providers |

Treat the candidate list as a starting sample. Include current defaults as measured baselines. Test a pinned spec and plan against multiple implementation models. Then test plans from multiple definition models with the same fast implementer. This measures the handoff as well as individual output quality.

## Qualification contract

1. Discover candidates under the same account, provider and runner profile that will dispatch them. Store a snapshot with adapter and CLI versions.
2. Smoke-test an explicit ID and effort. Check schema and tool permissions. Capture timeout behavior and exit status. Record any model identity the provider reports. Use a clean temporary workspace.
3. Run the existing workflow prompts against versioned fixtures. Capture the spec and plan. Save the test, review and implementation outputs. Keep a long-context fixture with a repository and references. Include research and architecture decision records.
4. Run deterministic gates first. Check required sections and reference coverage. Check forbidden changes and seeded defects. Verify observed RED and GREEN evidence against gate results. Reject a candidate that fails a required check.
5. Give both frontier judges blinded incumbent and candidate outputs. Randomize presentation order. Require structured scores with citations to the input, output and gate evidence. Compare meaning and coverage. Allow different wording and valid implementation choices.
6. Promote only after both judges find no material regression and the candidate wins its role's objective. Record disagreements for review and retain the incumbent.
7. Write a versioned pin update with the evidence and previous lock. Make the write atomic. Use an explicit promotion step so discovery and evaluation can run on a schedule without changing active routes.

Start with three independent runs per required fixture. This is a proposed calibration floor. Add repeated cases where the results vary. For definition, rank decision and requirement coverage before speed. For implementation, rank time to passing gates after behavioral equivalence. Record elapsed time and retries. Capture usage and cost where reported. Treat unavailable fields as missing.

Use synthetic or approved fixtures for cross-provider judging. Send private work code only to approved providers and accounts. Keep the two judge routes fixed during each comparison. If a provider exposes only a rolling alias or omits the effective identity, record that limit. Never claim a dated snapshot or verified exact execution from an opaque response.

## Pin and dispatch contract

Store discovery observations outside the plugin release. Keep qualified routes in a versioned, reviewable lock scoped to the workspace and runner profile. Keep credentials and live entitlement outside that lock. A route identifies the role and backend. It records the provider, exact supported ID and effort. It also carries the fallback order and evaluation evidence. Record versions for the CLI and adapter. Hash the workflow prompts and fixture suite. Requalify when one changes or the provider removes the model.

Route explicit backend selection through the same policy. Resolve its qualified model for the requested role. Keep provider default available as an explicit mode and label it in run evidence. Use only role-qualified fallbacks for pinned runs. Surface unavailable pins and fallback reasons. Record requested and observed model identity separately. Mark observation as unknown where the backend cannot supply it.

Add proposed `gwrk models discover`, `gwrk models evaluate` and `gwrk models promote` commands over one application workflow. Discovery belongs in plugin adapters. Ranking, promotion policy and route resolution belong in the functional core. WorkflowRuntime owns execution. Keep the plugin index and release checks for adapter changes. Refresh account catalogs and workspace pins without releasing a new plugin.

## Evidence

Live discovery verified Antigravity and Codex availability on this laptop. It did not measure prompt compatibility or qualify a model. The targeted routing and operations run passed 47 tests across nine files with one todo. Those tests establish the current test baseline.

Both `gwrk define spec` and `gwrk define plan` accepted a reference document in dry runs. Both displayed the selected backend. Neither showed an exact model for this project's current configuration. Preflight should show the role and model. It should also show effort and fallback.
