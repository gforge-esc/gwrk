# Model qualification implementation plan

Add model discovery, fixture evaluation and atomic route promotion behind hexagonal ports. Keep domain policy pure and exercise qualification cycles against synthetic fixtures with injected backend and judge ports. Blocked for live production command cutover until unified agent routing ships (`03-unified-agent-dispatch-and-stream-contracts`).

```mermaid
flowchart LR
  Discover["Discover catalog"] -->|snapshots| Evaluate["Evaluate fixtures"]
  Evaluate -->|gates| Judges["Two frontier judges"]
  Judges -->|qualifies| Promote["Atomic route lock"]
  Promote -->|pins| Routing["Unified route seam"]
```

## Upstream dependencies and boundaries

| Upstream work | Dependency status | Seam boundary | Affected phases |
|---|---|---|---|
| `040-pure-domain-boundary-gates` | Active | Keep `src/domain/` free of external imports, `process` and ambient `Date` | Phase 1 to Phase 5 |
| `042-port-adapter-separation` | Planned | Isolate filesystem, CLI and `WorkflowRuntime` effects in `src/adapters/` | Phase 2 to Phase 5 |
| `03-unified-agent-dispatch-and-stream-contracts` | Blocks live cutover | Expose one `AgentPort.selectRoute` choice and execution evidence seam | Phase 5 |

Phases 1 through 4 execute hermetically over [qualification ports](contracts/qualification-ports.md) and [evidence and lock schemas](contracts/evidence-and-lock.md). They do not touch `src/server/backend-selector.ts` or duplicate `config.agents` reads guarded by `src/utils/config-resolution.conformance.test.ts`.

### Phase 1: Domain policy and ports

Define pure candidate filtering and judge independence rules in `src/domain/`. Add deterministic HMAC blinding and promotion verdicts. Enforce staleness invalidation and secret checks. Declare inward port contracts without filesystem or subprocess effects (`ADR-011`).

#### Files

- `src/domain/model-qualification.ts` (NEW: Validate snapshots, judge independence and secret guards)
- `src/ports/model-qualification-port.ts` (NEW: Declare discovery and qualification port interfaces)
- `src/ports/index.ts` (MODIFY: Export model qualification port contracts)
- `src/domain/model-qualification.test.ts` (NEW: Test candidate rules, staleness hashes and secret rejection)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-001 | unit | `src/domain/model-qualification.test.ts` | Rejects absent models, `default` or `auto` aliases, hidden entries and secret patterns |
| TR-002 | unit | `src/domain/model-qualification.test.ts` | Retains incumbent on gate failure, missing citations or judge disagreement |
| TR-003 | unit | `src/domain/model-qualification.test.ts` | Marks pins stale when prompt hashes, fixture hashes or catalog availability change |
| TR-004 | gate | `src/architecture.test.ts` | Domain and port files satisfy inward dependency gates |

#### Done When

```bash
pnpm exec vitest run src/domain/model-qualification.test.ts src/architecture.test.ts
```

### Phase 2: Model discovery and smoke probes

Add discovery adapters separate from `dispatch()` (`ADR-006`). Support `agy models` and Codex App Server `model/list` pagination with effort mapping. Include native `claude` discovery and external adapter hooks (`cursor-agent` or `opencode` plus `aider` and `goose`) with unavailable-adapter reporting. Run bounded non-interactive smoke probes (`ADR-008`) in temporary workspaces and record `observedModel` or `"unknown"`.

#### Files

- `src/ports/agent-port.ts` (MODIFY: Add typed `effort`, `routeMode` and `observedModel` fields)
- `src/plugins/agent-backend.ts` (MODIFY: Add optional `discoverModels` method separate from `dispatch`)
- `src/plugins/builtins/agents/agy/adapter.ts` (MODIFY: Parse `agy models`, separate Antigravity Claude routes and read `init.model`)
- `src/plugins/builtins/agents/claude/adapter.ts` (MODIFY: Query active auth models, forward typed `effort` and extract `observedModel`)
- `src/plugins/builtins/agents/codex/adapter.ts` (MODIFY: Paginate `model/list`, filter hidden models and forward `effort`)
- `src/adapters/models/catalog-discovery.ts` (NEW: Collect built-in, external plugin and explicit candidate catalogs with versions)
- `src/adapters/models/smoke-probe.ts` (NEW: Run bounded exact-model and effort smoke probes in clean temporary directories)
- `src/adapters/models/catalog-discovery.test.ts` (NEW: Test catalog parsers and unavailable reporting)
- `src/adapters/models/smoke-probe.test.ts` (NEW: Verify the exact route, clean checkout, response schema and probe evidence)
- `src/utils/agent.ts` (MODIFY: Enforce explicit dispatch deadlines and allow synthetic fixtures to exclude external context)
- `src/utils/agent.test.ts` (MODIFY: Verify deadline expiry terminates the subprocess and reports a timeout)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-005 | unit | `src/adapters/models/catalog-discovery.test.ts` | Discovers new `agy`, `codex` and `claude` models without editing plugin manifests |
| TR-006 | unit | `src/adapters/models/catalog-discovery.test.ts` | Distinguishes Antigravity Claude routes from native `claude` and reports absent external CLIs |
| TR-007 | integration | `src/adapters/models/smoke-probe.test.ts` | Smoke probe checks exact model and effort in a temp workspace and preserves `"unknown"` `observedModel` |

#### Done When

```bash
pnpm exec vitest run src/adapters/models/catalog-discovery.test.ts src/adapters/models/smoke-probe.test.ts src/utils/agent.test.ts src/plugins/builtins/agents/agy/adapter.test.ts src/architecture.test.ts
```

### Phase 3: Synthetic fixtures and two-judge evaluation

Create versioned synthetic fixtures for long-context definition and seeded-defect implementation and review. Orchestrate three-repeat runs and both spec-to-implementation handoff directions. Enforce deterministic gates (`ADR-005`) before blinded two-judge scoring over injected backend and judge ports (`ADR-007`).

#### Files

- `tests/fixtures/model-qualification/suite.json` (NEW: Version synthetic definition, handoff and implementation fixtures)
- `tests/fixtures/model-qualification/define-long-context/fixture.json` (NEW: Bundle synthetic repo files, ADRs and research brief)
- `tests/fixtures/model-qualification/implement-seeded-defect/fixture.json` (NEW: Bundle fixed plan, seeded RED test and forbidden file paths)
- `src/application/models/evaluate-models.ts` (NEW: Orchestrate repeat fixtures, handoff checks and blinded two-judge scoring)
- `src/adapters/models/fixture-runner.ts` (NEW: Materialize synthetic workspaces and run report-only judge prompts via `WorkflowRuntime`)
- `src/application/models/evaluate-models.test.ts` (NEW: Seam tests with injected runner and judge ports for gates and judge splits)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-008 | integration | `src/application/models/evaluate-models.test.ts` | Executes three repeats per fixture and scores both `define` and `implement` handoff directions |
| TR-009 | unit | `src/application/models/evaluate-models.test.ts` | Rejects candidate on deterministic gate failure before calling `PromotionJudgePort` |
| TR-010 | unit | `src/application/models/evaluate-models.test.ts` | Enforces distinct judge providers and families, randomized blinding and citations to supplied artifacts |

#### Done When

```bash
pnpm exec vitest run src/application/models/evaluate-models.test.ts src/architecture.test.ts
```

### Phase 4: Route lock store and CLI

Persist runner-scoped discovery snapshots, evaluation bundles and temp-rename atomic route locks. Expose `gwrk models discover`, `gwrk models evaluate` and `gwrk models promote` with `[exit:N | Xs]` signals (`ADR-004`). Support `--format json`, rollback restoration and secret guards.

#### Files

- `src/application/models/promote-model.ts` (NEW: Verify evaluation freshness, assemble role pins and preserve `previousLock`)
- `src/adapters/models/route-lock-store.ts` (NEW: Persist runner snapshots, evaluation bundles and temp-rename atomic route locks)
- `src/commands/models.ts` (NEW: Implement `gwrk models discover`, `evaluate` and `promote` with `withSignal` and help examples)
- `src/cli.ts` (MODIFY: Register `modelsCommand` under Operations without intermediate option collisions)
- `src/adapters/models/route-lock-store.test.ts` (NEW: Test atomic rename safety, rollback restoration and secret rejection)
- `src/commands/models.test.ts` (NEW: Run synthetic CLI qualification, invalidation and rollback cycle)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-011 | integration | `src/adapters/models/route-lock-store.test.ts` | Failed writes and stale incumbent evidence leave the active lock intact. Rollback restores the previous lock. |
| TR-012 | integration | `src/commands/models.test.ts` | Synthetic end-to-end CLI cycle promotes passing candidate and rejects absent, stale or split-judge runs |
| TR-013 | gate | `src/cli.option-collisions.test.ts` | CLI consistency, help examples and option-collision gates pass |

#### Done When

```bash
pnpm exec vitest run src/adapters/models/route-lock-store.test.ts src/commands/models.test.ts src/cli.consistency.test.ts src/cli.option-collisions.test.ts src/cli.ux.test.ts src/architecture.test.ts
```

### Phase 5: Unified routing and live runbook

Connect `.gwrk/models/route-lock.<runner>.json` to the unified routing seam once `03-unified-agent-dispatch-and-stream-contracts` lands. Surface role and backend with model and effort in preflight banners. Persist fallback reason and observed identity in git-native run manifests (`ADR-003`). Keep live local and pilot runner qualification separate from synthetic CI tests.

#### Files

- `src/application/models/resolve-route.ts` (NEW: Resolve pinned routes, qualified fallbacks and `provider-default` mode)
- `src/utils/resolve-agent.ts` (MODIFY: Delegate pillar and role selection through `resolve-route` with centralized config access)
- `src/plugins/workflow-runtime.ts` (MODIFY: Forward typed `model`, `effort` and `routeMode` and return `observedModel`)
- `src/utils/manifest.ts` (MODIFY: Record `requestedModel`, `observedModel` and `fallbackReason` in manifests)
- `docs/operations/model-qualification-live.md` (NEW: Define separate live qualification steps for local workstation and Linux pilot runners)
- `src/application/models/resolve-route.test.ts` (NEW: Seam tests for pinned dispatch, qualified fallback chains and `provider-default` mode)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-014 | integration | `src/application/models/resolve-route.test.ts` | Dispatch uses pinned model and effort, restricts fallbacks to qualified pins and honors `provider-default` |
| TR-015 | unit | `src/utils/manifest.test.ts` | Execution manifests persist `requestedModel` and `observedModel` or `"unknown"` without credentials |
| TR-016 | gate | `src/utils/config-resolution.conformance.test.ts` | Config resolution stays centralized and architecture gates pass |

#### Done When

```bash
pnpm exec vitest run src/application/models/resolve-route.test.ts src/utils/manifest.test.ts src/utils/config-resolution.conformance.test.ts src/architecture.test.ts
```

## Coverage matrix

| Spec item | Summary | Phase | Verification target |
|---|---|---|---|
| Req 1 and Acc 1 | Execution-profile discovery with CLI and adapter versions and zero plugin edits | Phase 2 | `src/adapters/models/catalog-discovery.test.ts` |
| Req 2 | `agy`, `claude`, `codex` and external adapter discovery separate from `dispatch` | Phase 2 | `src/adapters/models/catalog-discovery.test.ts` |
| Req 3 | Exact model and effort smoke probe preserving `"unknown"` `observedModel` | Phase 2 | `src/adapters/models/smoke-probe.test.ts` |
| Req 4 | Versioned definition, implementation and review fixtures with repeat gates | Phase 3 | `src/application/models/evaluate-models.test.ts` |
| Req 5 and Acc 3 | Blinded two-judge comparison from distinct providers and families retaining incumbent | Phase 1 and Phase 3 | `src/application/models/evaluate-models.test.ts` |
| Req 6 | Coverage-first definition scoring, time-to-green implementation scoring and bidirectional handoff | Phase 3 | `src/application/models/evaluate-models.test.ts` |
| Req 7, Acc 2 and Acc 5 | Explicit promotion, atomic route lock, staleness invalidation and rollback | Phase 1 and Phase 4 | `src/adapters/models/route-lock-store.test.ts` |
| Req 8 and Acc 4 | `provider-default` route, unavailable-pin diagnostics, pinned dispatch and secret-free lock | Phase 4 and Phase 5 | `src/application/models/resolve-route.test.ts` |
| Acc 6 | Full synthetic cycle in CI and separate live runner qualification | Phase 4 and Phase 5 | `src/commands/models.test.ts` |

## Deferred items

- Live production cutover in Phase 5 waits on `03-unified-agent-dispatch-and-stream-contracts` unifying `src/server/backend-selector.ts` and `src/engine/router.ts` with `src/utils/resolve-agent.ts`.
- Live qualification runs for the local macOS workstation and hosted Linux runner execute outside hermetic CI under `docs/operations/model-qualification-live.md`.
