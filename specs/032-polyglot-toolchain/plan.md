# 032 — Implementation Plan

## Phases

### Phase 1 — ToolchainPort, Test Discovery, Runner, and Activator (8 SP)
- `src/ports/toolchain-port.ts` (NEW: Define `ToolchainPort` and polyglot adapters)
- `src/utils/test-discovery.ts` (MODIFY: Fix Python self-match and support Rust `tests/*.rs`)
- `src/utils/file-extract.ts` (MODIFY: Support `cmd/`, `internal/`, `pkg/`, `crates/`, `app/`, `lib/`)
- `src/engine/test-runner.ts` (MODIFY: Parse `go test` output in `parseTestOutput`)
- `src/engine/test-activator.ts` (MODIFY: Support Python, Go, and Rust skip markers)
- `src/commands/test.ts` (MODIFY: Route `gwrk test` through polyglot test runner)
- `src/utils/gate-gen.ts` (MODIFY: Emit profile-aware build and test commands)
- `src/commands/ship.ts` (MODIFY: Use polyglot source and test filtering in pre-flight)
- `src/engine/ship-orchestrator.ts` (MODIFY: Use `getBuildCommand` in `stageDiagnose`)

#### Done When
```bash
pnpm vitest run src/utils/test-discovery.test.ts src/engine/test-runner.test.ts src/utils/gate-gen.test.ts src/utils/toolchain-mapper.test.ts
```
