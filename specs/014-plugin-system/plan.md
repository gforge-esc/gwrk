# Implementation Plan: 014 Plugin System (F014-R Rework)

**Branch**: `develop` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a three-layer plugin architecture (Agent Backends, Skills, Workflows) that enables gwrk to be extended via CLI-native, pipe-composable plugins. This plan delivers the manifest-driven registry, the skill reasoning runtime, the Layer 1 AgentBackend adapters (ADR-006), and the Layer 2.5 WorkflowRuntime (JSON Intent Engine) required for shareability and bash eradication.

---

## Phases and File Structure

### Phase 1: Foundation (Plugin Loader & Registry)

Establish the core infrastructure for scanning, validating, and resolving plugins. This phase implements the Zod-validated `manifest.yaml` contract and the global-to-local resolution logic.

**Files (7):**
- `src/plugins/manifest.ts` (NEW: Zod schemas for Skill, Agent, and Workflow manifests)
- `src/plugins/loader.ts` (NEW: Plugin scanner, registry, and resolution engine)
- `src/commands/plugin.ts` (NEW: `gwrk plugin list/install/remove/disable/enable` handlers)
- `src/utils/config.ts` (MODIFY: Add support for reading `~/.gwrk/plugins/` paths)
- `src/plugins/manifest.test.ts` (NEW: Unit tests for manifest validation)
- `src/plugins/loader.test.ts` (NEW: Unit tests for resolution order)
- `src/commands/plugin.test.ts` (NEW: Integration tests for plugin CLI)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-013, US-001, US-002, US-003, US-004, TC-001, TC-002, TC-004, TC-005, TC-009

**Dependencies:** None

**Contract Mapping:**
- `contracts/plugin-registry.md` → `getPlugin(name)` → `src/plugins/loader.ts`
- `contracts/plugin-registry.md` → `listPlugins(options)` → `src/plugins/loader.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Plugin commands MUST emit `[exit:N | Xs]` signals |
| decision-forge | Applied to plugin resolution priority (Global vs Local) |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/plugins/manifest.ts` | Validates Atomic/Compound/Agent/Workflow manifests |
| TR-002 | Unit | `src/plugins/loader.ts` | Global -> Local Override -> Local Disable resolution order |
| TR-003 | Integration | `src/commands/plugin.ts` | `install` validates then copies; `remove` warns on dependencies |

#### Done When
- `pnpm vitest run src/plugins/loader.test.ts` exits 0

---

### Phase 2: Skill Runtime (Layer 2)

Implement the execution engine for Layer 2 plugins (Skills). This includes assembling multi-pass prompts for compound skills and invoking agents with the full F013 contract.

**Files (5):**
- `src/plugins/skill-runtime.ts` (NEW: Atomic/Compound assembly and execution logic)
- `src/commands/skill.ts` (NEW: `gwrk skill <name>` command handler)
- `src/utils/agent-layer.ts` (MODIFY: Support ANSI stripping and binary guards for skill output)
- `src/plugins/skill-runtime.test.ts` (NEW: Unit tests for prompt assembly)
- `src/commands/skill.test.ts` (NEW: Integration tests for skill piping)

**Requirements Addressed:** FR-006, FR-007, FR-008, FR-009, FR-010, US-005, US-006, US-007, US-008, TC-007, TC-008

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/skill-runtime.md` → `executeSkill(name, input)` → `src/plugins/skill-runtime.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Skill output MUST be ANSI-stripped in --agent mode |
| skills-architecture.md | Two-tier hierarchy enforcement |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/plugins/skill-runtime.ts` | Compound skills assemble all passes into a single prompt |
| TR-008 | Integration | `src/commands/skill.ts` | `gwrk skill A | gwrk skill B` preserves signals on stderr |

#### Done When
- `echo "test" | gwrk skill narrative` (mocked) exits 0 with signal on stderr

---

### Phase 3: Agent Backend Adapters (Layer 1 - ADR-006)

Implement the normalized `AgentBackend` interface. This replaces hardcoded CLI dispatch with a plugin-driven adapter model.

**Files (7):**
- `src/plugins/builtins/agents/index.ts` (NEW: Static registry of built-in adapters)
- `src/plugins/builtins/agents/claude/adapter.ts`, `gemini/adapter.ts`, `codex/adapter.ts` (NEW: Adapters)
- `src/utils/agent.ts` (MODIFY: Replace spawn logic with `AgentBackend.dispatch()`)
- `src/commands/sync-context.ts` (NEW: `gwrk plugin sync-context` handler)
- `src/db/migrations/003-agent-context.sql` (NEW: Track sync state in SQLite)
- `src/plugins/agent-adapter.test.ts` (NEW: Verify exit normalization)

**Requirements Addressed:** FR-L1-001 to FR-L1-013, TC-010, ADR-006

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/agent-backend.md` → `dispatch(task)` → `src/plugins/builtins/agents/*`
- `contracts/agent-backend.md` → `syncGovernance(root, gov)` → `src/plugins/builtins/agents/*`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006 | Stdin context delivery is REQUIRED |
| ADR-006 | Exit code normalization: Gemini 53 -> gwrk 1 |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| FR-L1-003 | Unit | `parseResult()` | Normalizes proprietary exit codes to gwrk standard |
| FR-L1-004 | Integration | `syncGovernance()` | Updates context files from agent-context.md |

#### Done When
- `gwrk plugin sync-context` generates context files with boundary markers

---

### Phase 4: Antigravity (agy) Adapter

Add the Antigravity CLI (`agy`) as a fourth built-in agent backend. `agy` is the successor to `gemini-cli` (same Gemini models, Go-based CLI). Deadline: `gemini-cli` Google One tier ends June 18, 2026.

**Files (4):**
- `src/plugins/builtins/agents/agy/adapter.ts` (NEW: `AgyAdapter` implementing `AgentBackend` — `--print`, `--dangerously-skip-permissions`, `AGENTS.md`)
- `src/plugins/builtins/agents/agy/adapter.test.ts` (NEW: Unit tests for dispatch, parseResult, syncGovernance, isAvailable)
- `src/plugins/builtins/agents/index.ts` (MODIFY: Register `AgyAdapter` in `BUILTIN_AGENTS`)
- `src/engine/router.ts` (MODIFY: Add `agy` to fallback chain after `gemini`)

**Requirements Addressed:** FR-L1-001, FR-L1-002, FR-L1-003, FR-L1-004, FR-L1-010

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/agent-backend.md` → `dispatch(task)` → `src/plugins/builtins/agents/agy/adapter.ts`
- `contracts/agent-backend.md` → `syncGovernance(root, gov)` → `src/plugins/builtins/agents/agy/adapter.ts`

#### Flag Mapping (agy ↔ gemini)
| gwrk Concept | gemini CLI | agy CLI |
|-------------|-----------|---------|
| Non-interactive | `-p "<prompt>"` | `--print "<prompt>"` |
| Skip approvals | `--approval-mode yolo` | `--dangerously-skip-permissions` |
| Model selection | `--model <model>` | N/A (env var `AGY_MODEL`) |
| Sandbox off | `--sandbox false` | Not sandboxed by default |
| Context file | `GEMINI.md` | `AGENTS.md` |

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006 | Stdin context delivery is REQUIRED |
| ADR-006 | Exit code normalization: Go-style (0/1/2) preserved, >2 → 1 |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-3A-001 | Unit | `AgyAdapter.dispatch()` | Returns `agy --print <prompt> --dangerously-skip-permissions` |
| TR-3A-002 | Unit | `AgyAdapter.parseResult()` | Normalizes exit codes >2 to 1 (agent_error), preserves 127 |
| TR-3A-003 | Unit | `AgyAdapter.syncGovernance()` | Writes `AGENTS.md` with gwrk boundary markers, preserves external content |
| TR-3A-004 | Unit | `AgyAdapter.isAvailable()` | Checks `which agy` |

#### Done When
- `pnpm vitest run src/plugins/builtins/agents/agy/adapter.test.ts` exits 0
- `pnpm biome check src/plugins/builtins/agents/agy/adapter.ts` exits 0

---

### Phase 5: WorkflowRuntime (Layer 2.5 - F014-R)

Implement the `WorkflowRuntime` engine and the `IntentEngine` for native filesystem mutation. This is the core of the F014-R rework.

**Files (6):**
- `src/plugins/workflow-runtime.ts` (NEW: Resolve and execute workflows via agents)
- `src/engine/intent-engine.ts` (NEW: Native FS mutation: `WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND`)
- `src/plugins/builtins/workflows/` (NEW: 10 core workflows as built-in plugins)
- `src/plugins/workflow-runtime.test.ts` (NEW: Verify JSON intent parsing and validation)
- `src/engine/intent-engine.test.ts` (NEW: Verify FS path containment and execution)

**Requirements Addressed:** FR-L25-001, FR-L25-002, FR-L25-006, FR-L25-007, US-011, US-012, US-015, TC-011

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/workflow-runtime.md` → `executeWorkflow(name, input)` → `src/plugins/workflow-runtime.ts`
- `contracts/workflow-runtime.md` → `executeIntents(intents, root)` → `src/engine/intent-engine.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| cascade-sync | LLMs MUST NOT directly mutate the filesystem |
| decision-forge | Path containment enforcement for `IntentEngine` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-009 | Unit | `WorkflowRuntime` | Catches invalid JSON intents and exits 1 |
| TR-011 | Integration | `IntentEngine` | Blocks file writes outside the project root |

#### Done When
- `gwrk-specify` workflow executes in memory and returns valid `WRITE_FILE` intents

---

### Phase 6: DefineOrchestrator & CLI Rewiring

Implement the `DefineOrchestrator` state machine and rewire existing commands to use the `WorkflowRuntime`. This eradicates the dependency on `define-until-solid.sh`.

**Files (5):**
- `src/engine/define-orchestrator.ts` (NEW: TS state machine for spec->plan->tasks loop)
- `src/commands/specify.ts`, `plan.ts`, `tasks-generate.ts` (MODIFY: Rewire to `WorkflowRuntime`)
- `src/engine/define-orchestrator.test.ts` (NEW: Verify state transitions)
- `src/commands/specify.test.ts`, `plan.test.ts` (MODIFY: E2E verification)

**Requirements Addressed:** FR-L25-003, FR-L25-004, US-011, US-013

**Dependencies:** Phase 4

**Contract Mapping:**
- `contracts/workflow-runtime.md` → `runLoop(specPath)` → `src/engine/define-orchestrator.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| architecture-stress-test | Applied to state machine transitions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-010 | Unit | `DefineOrchestrator` | Transitions through SPEC, PLAN, TASKS sequentially |
| TR-012 | E2E | `gwrk specify` | Successfully creates a spec file via WorkflowRuntime |

#### Done When
- `gwrk specify my-feature` works in a directory without an `.agents/` folder

---

### Phase 7: Provisioning & Migration

Overhaul `gwrk init` to provision the global home and provide migration/seeding tools.

**Files (6):**
- `src/commands/init.ts` (MODIFY: Provision `~/.gwrk/plugins/` with built-ins)
- `src/plugins/migrate.ts` (NEW: `.agents/` to `~/.gwrk/plugins/` migration)
- `src/plugins/seed.ts` (NEW: Taxonomy to atomic skills seeding)
- `src/commands/init.test.ts`, `src/plugins/migrate.test.ts`, `src/plugins/seed.test.ts`

**Requirements Addressed:** FR-011, FR-012, FR-L25-005, US-009, US-010, US-014, TC-006

**Dependencies:** Phase 2, Phase 4, Phase 5

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-006 | Original `.agents/` files MUST NOT be deleted during migration |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `migrate()` | Generates valid `manifest.yaml` from frontmatter |
| TR-006 | Unit | `seed()` | Categories (reasoning, evaluative, etc.) are preserved |

#### Done When
- `gwrk init` populates `~/.gwrk/plugins/workflows/` with 10 core workflows

---

### Phase 8: Routing & Intelligence (ex-F008)

Implement the routing engine that selects the optimal backend based on task type, quota, and historical success.

**Files (5):**
- `src/engine/router.ts` (NEW: `selectBackend()` logic with fallback chains)
- `src/engine/quota.ts` (NEW: Quota probing per adapter)
- `src/db/migrations/004-routing-history.sql` (NEW: `routing_decisions` table)
- `src/engine/router.test.ts` (NEW: Verify fallback chains and historical learning)
- `src/commands/status.ts` (MODIFY: Include backend availability in status)

**Requirements Addressed:** FR-014 (Phase 4), FR-L1-005, TC-009

**Dependencies:** Phase 3

**Contract Mapping:**
- `contracts/router.md` → `selectBackend(task)` → `src/engine/router.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| decision-forge | Applied to fallback ordering and quota prioritization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| FR-P4-001 | Unit | `selectBackend()` | Respects `fallbackOrder` from `.gwrkrc.json` |
| FR-P4-002 | Unit | `quotaProbe()` | Detects 429/rate-limit and applies backoff |

#### Done When
- `gwrk status` correctly identifies unavailable backends via quota probing
---

### Phase 8A: Review Plugin Layer (Layer 3 — First Extension) ✅ SHIPPED

> **Absorbed into Phase 10/11 shipment.** ReviewPlugin, review-code-cli, review-uat-cli are live in `src/plugins/`. No tasks.json phase — work was completed prior to task tracking.

**Requirements Addressed:** F014 Layer 3 (partial), F004 ship orchestrator decoupling
**Dependencies:** Phase 1 (loader/registry), Phase 5 (WorkflowRuntime)

#### Files
- `src/plugins/review-plugin.ts` (NEW: `ReviewPlugin` interface, `ReviewStep` schema, resolution)
- `src/plugins/builtins/reviews/review-code-cli/` (NEW: built-in CLI code review plugin)
- `src/plugins/builtins/reviews/review-uat-cli/` (NEW: built-in CLI UAT review plugin)
- `src/plugins/builtins/reviews/review-code-webapp/` (NEW: built-in webapp code review plugin)
- `src/plugins/builtins/reviews/review-uat-webapp/` (NEW: built-in webapp UAT review plugin)
- `src/engine/ship-orchestrator.ts` (MODIFY: delegate to ReviewPlugin, add post-dispatch phase-scope validation)
- `src/plugins/review-plugin.test.ts` (NEW: unit tests)

#### Governance & Skills Contract
- `contracts/review-plugin.md` → `ReviewPlugin` interface, `ReviewStep` schema, `ReviewDispatch` return type
- Plugin owns strategy (what to build, test, check). Orchestrator owns enforcement (phase-scope validation via snapshot + diff + revert).
- Every review plugin declares steps as a template; steps support `skip: true`.

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-013 | Unit | `resolveReviewPlugin()` | Returns correct plugin for project type |
| TR-014 | Unit | Phase-scope validation | Reverts cross-phase task mutations |
| TR-015 | Integration | Ship loop with review plugin | End-to-end dispatch via plugin resolution |

#### Done When
- `ShipOrchestrator` no longer hardcodes workflow paths — resolves via `ReviewPlugin`
- Post-dispatch validation reverts any cross-phase task re-opens
- `.gwrkrc.json` `review` field selects active review strategy

---

### Phase 9: Enforcement Skills (FR-014 / US-016)

Ship builtin enforcement skills that teach implementing agents gwrk's operational vocabulary and coding standards. Enforcement skills are auto-loaded by SkillRuntime at dispatch time and injected into agent context for all write workflows (implement, review-code, review-uat).

**Design Decisions (ADR-006 §2.2, ADR-007 §2.2):**
- **Loading**: SkillRuntime auto-injection at dispatch time (ADR-006 Dual-Layer Context — enforcement sits at Layer 1/2 boundary)
- **Resolution**: `tier: enforcement` follows workflow resolution order (builtins → global → project-local), not global-only. This is a semantic exception to TC-004 per US-016 AC 3.
- **Naming**: Two separate builtins — `gwrk-conventions` (platform vocabulary) + `typescript-standards` (language/toolchain)

**Files (8):**
- `src/plugins/builtins/skills/gwrk-conventions/SKILL.md` (NEW: valid task statuses, tasks.json Zod schema, commit identity rules, `.agents/` is legacy, file naming)
- `src/plugins/builtins/skills/gwrk-conventions/manifest.yaml` (NEW: `type: skill`, `tier: enforcement`, `scope: implementation`)
- `src/plugins/builtins/skills/typescript-standards/SKILL.md` (NEW: strict typing, no `any`, lint compliance, no `.js`/`.jsx` in `src/`, ESM conventions)
- `src/plugins/builtins/skills/typescript-standards/manifest.yaml` (NEW: `type: skill`, `tier: enforcement`, `scope: implementation`)
- `src/plugins/skill-runtime.ts` (MODIFY: add `resolveEnforcementSkills(projectRoot)` — scans builtins, global, and project-local for `tier: enforcement` manifests, returns SKILL.md content)
- `src/plugins/manifest.ts` (MODIFY: add `tier: enforcement` to `SkillManifestSchema`, add `scope` field)
- `src/utils/agent.ts` (MODIFY: call `resolveEnforcementSkills()` during dispatch context assembly, inject into `<code_quality>` section)
- `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md` (MODIFY: replace inline `<code_quality>` placeholder with `{{enforcement}}` marker — resolved by SkillRuntime)

**Requirements Addressed:** FR-014, US-016, FR-013 (enforcement tier), FR-010 (help listing)

**Dependencies:** Phase 1 (manifest schema), Phase 2 (skill runtime), Phase 8A (review dispatch)

**Contract Mapping:**
- `contracts/skill-runtime.md` → `resolveEnforcementSkills(root)` → `src/plugins/skill-runtime.ts`
- `contracts/plugin-registry.md` → `tier: enforcement` manifest → `src/plugins/manifest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-005 | Gates MUST verify enforcement skill content is injected into dispatch prompts |
| ADR-006 §2.2 | Enforcement skills are Layer 1 (Durable Governance) content — project-level, not per-task |
| ADR-007 §2.2 | Resolution follows builtins → global → project-local hierarchy |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P9-001 | Unit | `skill-runtime.ts` | `resolveEnforcementSkills()` returns builtin SKILL.md content |
| TR-P9-002 | Unit | `skill-runtime.ts` | Project-local `.gwrk/plugins/skills/typescript-standards/` overrides builtin |
| TR-P9-003 | Unit | `manifest.ts` | `tier: enforcement` validates in SkillManifestSchema; `scope: implementation` accepted |
| TR-P9-004 | Integration | `gwrk plugin list` | Shows enforcement skills with `tier: enforcement` grouping |
| TR-P9-005 | Integration | Dispatch context | `dispatchToAgent()` stdin includes enforcement skill content in `<code_quality>` section |
| TR-P9-006 | Unit | `gwrk-conventions` SKILL.md | Contains valid task status enum: `open \| in_progress \| completed \| cancelled` |

#### Done When
- `gwrk plugin list --type skills | grep typescript-standards` exits 0 with `tier: enforcement`
- `gwrk plugin list --type skills | grep gwrk-conventions` exits 0 with `tier: enforcement`
- Implementing agent's dispatch prompt includes enforcement skill content (verified by TR-P9-005)
- Local `.gwrk/plugins/skills/typescript-standards/` overrides builtin (verified by TR-P9-002)
- `pnpm build` passes
- `pnpm test` passes

---

> Eliminate gwrk's runtime dependency on the `.agents/` directory by migrating all content into the builtin plugin architecture. After this phase, `.agents/` is inert — nothing reads from it at runtime.

**Requirements Addressed:** FR-L25-003 (core workflows independent of `.agents/`), TC-011 (zero-dependency workflows), US-011 (execute workflows without `.agents/`), ADR-007

**Dependencies:** Phase 8 (review dispatch already migrated)

#### Files

**Rules migration:**
- `src/plugins/builtins/rules/operating-model.md` (NEW: copy from `.agents/rules/operating-model.md`)
- `src/plugins/builtins/rules/workspace.md` (NEW: copy from `.agents/rules/workspace.md`)
- `src/commands/init.ts` (MODIFY: seed `.gwrk/rules/` from `builtins/rules/` during `gwrk init`)

**Missing builtin workflows (5):**
- `src/plugins/builtins/workflows/gwrk-analyze/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` (NEW: from `.agents/workflows/gwrk-analyze.md`)
- `src/plugins/builtins/workflows/gwrk-cascade-sync/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-cascade-sync/PROMPT.md` (NEW: from `.agents/workflows/gwrk-cascade-sync.md`)
- `src/plugins/builtins/workflows/gwrk-checklist/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-checklist/PROMPT.md` (NEW: from `.agents/workflows/gwrk-checklist.md`)
- `src/plugins/builtins/workflows/gwrk-constitution/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` (NEW: from `.agents/workflows/gwrk-constitution.md`)
- `src/plugins/builtins/workflows/gwrk-effort/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-effort/PROMPT.md` (NEW: from `.agents/workflows/gwrk-effort.md`)

**Personas:**
- `src/plugins/builtins/personas/principal-engineer.md` (NEW: from `.agents/prompts/personas/`)
- `src/plugins/builtins/personas/product-manager.md` (NEW: from `.agents/prompts/personas/`)
- `src/plugins/builtins/personas/senior-dev.md` (NEW: from `.agents/prompts/personas/`)

**Templates:**
- `.specify/templates/verification-gate.md` (NEW: from `.agents/templates/verification-gate.md`)
- `.specify/templates/monorepo-context.md` (NEW: from `.agents/templates/monorepo-context.md`)
- `.specify/templates/e2e-patterns.md` (NEW: from `.agents/templates/e2e-patterns.md`)

**Reference updates:**
- `src/plugins/skill-runtime.ts` (MODIFY: remove `.agents/skills/` symbolic log path at L125)
- `src/server/slack-agent.ts` (MODIFY: remove `.agents/workflows/` string check at L26)
- `AGENTS.md` (MODIFY: `.agents/rules/` → `.gwrk/rules/`)

**Dead code removal:**
- `.agents/scripts/parser/parser-scaffold.sh` — not referenced in src/. Delete.
- `.agents/scripts/parser/parser-validate.sh` — not referenced in src/. Delete.
- `.agents/workflows/plan.md` — superseded by `gwrk-plan`. Delete.
- `.agents/workflows/specify.md` — superseded by `gwrk-specify`. Delete.

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| governance-audit | Verify all 15 gwrk-* workflows resolve from builtins without .agents/ |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P10-001 | Unit | `init.ts` rules seeding | `gwrk init` creates `.gwrk/rules/operating-model.md` and `workspace.md` |
| TR-P10-002 | Integration | Builtin workflow resolution | All 15 `gwrk-*` workflows resolve via `PluginLoader` from builtins dir |
| TR-P10-003 | Unit | `skill-runtime.ts` | No `.agents/` path in log strings |
| TR-P10-004 | Unit | `slack-agent.ts` | No `.agents/workflows/` string check |

#### Done When
- `gwrk init` creates `.gwrk/rules/` with `operating-model.md` and `workspace.md`
- All 15 `gwrk-*` workflows resolve from `builtins/workflows/` (verified by TR-P10-002)
- No runtime source file contains a hardcoded `.agents/` filesystem path
- `pnpm build` passes
- `pnpm test` passes

---

### Phase 11: .agents/ Deletion & Verification (ADR-007)

> Delete the `.agents/` directory from the repository and verify gwrk functions without it. This is the final cleanup — all content has been migrated in Phase 10.

**Requirements Addressed:** US-011 AC L303 ("No `.agents/` directory is created in the project root by default"), TC-011, ADR-007

**Dependencies:** Phase 10

#### Files
- `.agents/` (DELETE: entire directory tree — 39 files)
- `src/plugins/migrate.ts` (MODIFY: add deprecation warning if `.agents/` detected — advise `gwrk init`)
- `src/engine/drift-detector.ts` (MODIFY: remove `.agents/` artifact check at L24-52 — directory no longer exists)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| governance-audit | Post-deletion full verification |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P11-001 | Integration | Full workflow resolution | `gwrk define spec --help` resolves, no `.agents/` fallback |
| TR-P11-002 | Integration | Review dispatch | `gwrk ship` review stage sends full PROMPT.md, not skeleton |
| TR-P11-003 | Unit | `migrate.ts` | Warns when `.agents/` exists in target project |
| TR-P11-004 | Unit | `drift-detector.ts` | No `.agents/` references in drift checks |

#### Done When
- `.agents/` directory does not exist in the repository
- `git ls-files .agents/` returns empty
- `grep -rn '\.agents/' src/ --include='*.ts'` returns zero results (excluding `config.agents` property access)
- `pnpm build` passes
- `pnpm test` passes
- `gwrk define spec --help` resolves workflow from builtins

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AnyManifest` | `src/plugins/manifest.ts` | Loader, Registry, CLI |
| `JsonIntent` | `src/plugins/manifest.ts` | WorkflowRuntime, IntentEngine |
| `TaskDispatch` | `src/utils/agent.ts` | AgentBackend, Router |
| `TaskResult` | `src/utils/agent.ts` | AgentBackend, Ship Loop |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-L1-007 | github-integration dispatchMode | Codex Cloud integration is a separate high-effort feature (F005 Tier 3) | Wave 5 |
| Layer 3 | Extension Plugins (remaining) | Review plugins (Phase 8) are the first L3 use case. Domain Packs and Channel Adapters require F012 and F017 | Wave 7 |
| `.agents/skills/` | Skill migration via `gwrk plugin migrate` | Skills already dual-exist in `~/.gwrk/plugins/skills/` (seeded by init). `.agents/skills/` retained for IDE compatibility per TC-006 | Phase 11 deletes `.agents/` wholesale |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | ✅ Done |
| US-002 | 1 | ✅ Done |
| US-003 | 1 | ✅ Done |
| US-004 | 1 | ✅ Done |
| US-005 | 2 | ✅ Done |
| US-006 | 2 | ✅ Done |
| US-007 | 2 | ✅ Done |
| US-008 | 2 | ✅ Done |
| US-009 | 7 | ✅ Done |
| US-010 | 7 | ✅ Done |
| US-011 | 5, 6 | ✅ Done |
| US-012 | 5 | ✅ Done |
| US-013 | 6 | ✅ Done |
| US-014 | 7 | ✅ Done |
| US-015 | 5 | ✅ Done |
| US-016 | 9 | ✅ Done |
| FR-001 | 1 | ✅ Done |
| FR-002 | 1 | ✅ Done |
| FR-003 | 1 | ✅ Done |
| FR-004 | 1 | ✅ Done |
| FR-005 | 1 | ✅ Done |
| FR-006 | 2, 3 | ✅ Done |
| FR-007 | 2 | ✅ Done |
| FR-008 | 2 | ✅ Done |
| FR-009 | 2 | ✅ Done |
| FR-010 | 2 | ✅ Done |
| FR-011 | 7 | ✅ Done |
| FR-012 | 7 | ✅ Done |
| FR-013 | 1, 9 | ✅ Done |
| FR-014 | 9 | ✅ Done |
| FR-L1-001 | 3, 4 | ✅ Done |
| FR-L1-002 | 3, 4 | ✅ Done |
| FR-L1-003 | 3, 4 | ✅ Done |
| FR-L1-004 | 3, 4 | ✅ Done |
| FR-L1-005 | 3, 8 | ✅ Done |
| FR-L1-006 | 3 | ✅ Done |
| FR-L1-007 | Deferred | ✅ Done |
| FR-L1-008 | 7 | ✅ Done |
| FR-L1-009 | 3 | ✅ Done |
| FR-L1-010 | 3, 4 | ✅ Done |
| FR-L1-011 | 1 | ✅ Done |
| FR-L1-012 | 1 | ✅ Done |
| FR-L1-013 | 1 | ✅ Done |
| FR-L25-001 | 5 | ✅ Done |
| FR-L25-002 | 5 | ✅ Done |
| FR-L25-003 | 6, 10 | ✅ Done |
| FR-L25-004 | 6 | ✅ Done |
| FR-L25-005 | 7 | ✅ Done |
| FR-L25-006 | 5 | ✅ Done |
| FR-L25-007 | 5 | ✅ Done |
| DM-001 to DM-007 | 1 | ✅ Done |
| TC-006 | 10, 11 | ✅ Done |
| TC-011 | 10, 11 | ✅ Done |
| TR-001 to TR-012 | All | ✅ Done |
| TR-P10-001 to TR-P10-004 | 10 | ✅ Done |
| TR-P11-001 to TR-P11-004 | 11 | ✅ Done |
| TR-P9-001 to TR-P9-006 | 9 | ✅ Done |
| VR-011 to VR-016 | All | ✅ Done |
