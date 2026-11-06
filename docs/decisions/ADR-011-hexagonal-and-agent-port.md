# ADR-011: Hexagonal Layering, Unified AgentPort, and Polyglot ToolchainPort

> **Status:** Decided
> **Date:** 2026-11-02
> **Decision:** `gwrk` enforces a four-layer Hexagonal Architecture (`domain`, `ports`, `application`, `adapters`) with a single `AgentPort` router and a language-agnostic `ToolchainPort`.
> **Constraint:** Domain and application modules MUST depend only on `src/domain/` and `src/ports/`, and MUST NOT import infrastructure adapters, duplicate agent registries, or hardcode TypeScript toolchain commands.
> **Depends on:** ADR-005 (TDD Gate Architecture), ADR-006 (Plugin Agent Backends), ADR-007 (Single Dispatch Path), ADR-010 (Decision Records)
> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture, agent routing, polyglot toolchain, and plugin runtime

---

## 1. Context

Between releases `1.4.0` and `1.5.2-alpha.2`, `gwrk` accumulated seven bidirectional dependency cycles across `src/commands/`, `src/engine/`, `src/plugins/`, `src/server/`, `src/utils/`, and `src/db/`. Three separate agent routers competed across `src/server/backend-selector.ts`, `src/engine/router.ts`, and `src/utils/resolve-agent.ts`. Agent adapters passed multi-kilobyte prompts inline via `-p` flags while leaving raw `stream-json` in `TaskResult.stdout`. In addition, `gwrk test`, `gate-gen.ts`, `ship.ts`, and `test-discovery.ts` hardcoded TypeScript and Vitest assumptions.

## 2. Decision

### 2.1 Strict Four-Layer Hexagonal Package Structure

Source files in `src/` are organized into four layers with a strict inward dependency rule:

1. `src/domain/`: Pure domain types, parsers, and solvers with zero imports from `application`, `ports`, `adapters`, `node:fs`, `node:child_process`, or `better-sqlite3`.
2. `src/ports/`: Inbound and outbound port interfaces (`AgentPort`, `ToolchainPort`, `NotificationPort`, repository ports) importing only from `src/domain/`.
3. `src/application/`: Orchestrators and use-case services importing only from `src/domain/` and `src/ports/`.
4. `src/adapters/`: Infrastructure implementations (`cli`, `server`, `sqlite`, `git`, `agents`, `plugins`, `toolchain`) implementing `src/ports/`.

### 2.2 Unified AgentPort and Stdin-First Adapter Contract

`src/plugins/agent-registry.ts` is the single canonical agent registry. `src/server/agent-registry.ts` is removed, and `QuotaProber` plus `ModelSelector` are unified into the single router in `src/engine/router.ts`. Before calling `adapter.dispatch(task)`, the dispatcher assembles the prompt, grounding bundle, enforcement skills, extension context, and `<command_safety>` block into `task.stdin`. Every adapter delivers `task.stdin` via standard input and unwraps `stream-json` inside `adapter.parseResult` so callers receive clean text and structured telemetry.

### 2.3 Language-Agnostic ToolchainPort

All build, test, file-classification, test-discovery, test-activation, and gate-generation paths route through `ToolchainPort`. No command, gate generator, or orchestrator may hardcode `pnpm build`, `pnpm vitest run`, or `.ts` file filters.

### 2.4 Functional Plugin Runtime and NotificationPort

`SkillRuntimeSchema` makes `preferredModel` optional with a `"default"` fallback so seeded skills validate cleanly. `SkillRuntime.assemblePrompt` loads `SKILL.md` for atomic and compound skills. `AgentBackendRegistry` dynamically imports user-installed agent adapters from `~/.gwrk/plugins/agents/`. `PluginRegistry` installs directly from Git URLs or local paths using recursive copy and `.gwrk-source.json` metadata. Slack and Telegram notifications route through `NotificationPort`.

## 3. Decision Record

| Field | Value |
|---|---|
| Position | Enforce four-layer Hexagonal boundaries via `src/architecture.test.ts`, unify routing on `AgentPort`, and route all language operations through `ToolchainPort`. |
| Confidence | 9/10 |
| Reversibility | High. Public CLI commands and SQLite schemas remain unchanged. |
| Risk | Low. Internal import paths change during the `WS-5` cutover, mitigated by re-export shims during migration and automated boundary tests. |

## 4. Alternatives Rejected

- **Keeping `src/utils/` as a mixed service layer:** Rejected because `src/utils/` housed `agent.ts` and `gate-gen.ts`, creating five bidirectional dependency cycles.
- **Keeping separate CLI and daemon agent registries:** Rejected because dual registries caused `ShipOrchestrator` to ignore `BackendSelector`'s `selectedCommand` output.
- **Per-command language branches:** Rejected because scattering language regexes across `test.ts`, `gate-gen.ts`, and `ship.ts` caused Python, Go, and Rust regressions.

## 5. Impact on Existing Code

- `src/ports/agent-port.ts`, `src/ports/toolchain-port.ts`, `src/ports/notification-port.ts`: new port contracts.
- `src/utils/agent.ts`, `src/plugins/builtins/agents/*/adapter.ts`, `src/engine/router.ts`: unified stdin-first dispatch and stream-json unwrapping.
- `src/commands/test.ts`, `src/utils/gate-gen.ts`, `src/utils/test-discovery.ts`, `src/engine/test-runner.ts`, `src/engine/test-activator.ts`: polyglot `ToolchainPort` integration.
- `src/plugins/seed.ts`, `src/plugins/skill-runtime.ts`, `src/plugins/agent-registry.ts`, `src/engine/registry.ts`: functional Layer 1, Layer 2, and Layer 3 plugin runtime.
- `src/domain/`, `src/ports/`, `src/application/`, `src/adapters/`, `src/architecture.test.ts`: four-layer Hexagonal structure and automated boundary gate.

## 6. Consequences

- Every agent backend (`agy`, `claude`, `codex`, and user plugins) receives full context over `stdin` and returns unwrapped output through one router.
- Python, Go, Rust, and TypeScript projects use the same `gwrk define`, `gwrk test`, `gwrk gate`, and `gwrk ship` pipeline.
- Architectural boundary regressions fail `pnpm test` via `src/architecture.test.ts`.

## 7. References

- `docs/grounding-and-architecture-audit.md`
- `specs/030-dogfood-spine/spec.md`
- `specs/031-unified-agent-port/spec.md`
- `specs/032-polyglot-toolchain/spec.md`
- `specs/033-plugin-runtime/spec.md`
- `specs/034-hexagonal-architecture/spec.md`

## Amendments

| Amending | At | Summary |
|---|---|---|
