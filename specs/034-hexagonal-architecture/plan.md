# 034 — Implementation Plan

## Phases

### Phase 1 — Four-Layer Hexagonal Structure, Cycle Elimination, and Architecture Gate (13 SP)
- `src/domain/index.ts` (NEW: Pure domain layer exports and modules)
- `src/ports/index.ts` (NEW: Port interfaces)
- `src/application/index.ts` (NEW: Application use-case services and modular ship stage handlers)
- `src/adapters/index.ts` (NEW: Infrastructure adapters for cli, server, sqlite, git, agents, plugins, toolchain)
- `src/architecture.test.ts` (NEW: Automated Hexagonal layer and cycle gate)

#### Done When
```bash
pnpm vitest run src/architecture.test.ts
```
