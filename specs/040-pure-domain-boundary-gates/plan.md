# Domain purity implementation plan

Enforce the boundary with the TypeScript syntax tree. Move Git discovery, configuration reads and manifest reads out of the domain. Blocked: none.

### Phase 1: Boundary gate

**Files (2):**
- `src/architecture.test.ts` (MODIFY: Exercise package imports, dynamic dependencies and prompt text)
- `tests/helpers/architecture-boundary.ts` (NEW: Check TypeScript syntax and layer rules)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-001 | Test | `src/architecture.test.ts` | The suite passes |
| TR-002 | Test | `src/engine/harvest.test.ts` | The suite passes |
| TR-003 | Test | `src/engine/issues.test.ts` | The suite passes |

#### Done When

```bash
pnpm exec vitest run src/architecture.test.ts src/engine/harvest.test.ts src/engine/issues.test.ts
```

### Phase 2: Project identity

**Files (2):**
- `src/domain/project-id.ts` (MODIFY: Compute the existing identity from supplied facts)
- `src/adapters/git/project-id.ts` (NEW: Discover the remote and main worktree through bounded Git commands)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-004 | Test | `src/domain/project-id.test.ts` | The suite passes |
| TR-005 | Test | `src/utils/project-id.test.ts` | The suite passes |
| TR-006 | Test | `src/db/runs.test.ts` | The suite passes |
| TR-007 | Test | `src/architecture.test.ts` | The suite passes |

#### Done When

```bash
pnpm exec vitest run src/domain/project-id.test.ts src/utils/project-id.test.ts src/db/runs.test.ts src/architecture.test.ts
```

### Phase 3: Agent registry

**Files (2):**
- `src/domain/agent-config.ts` (MODIFY: Validate and merge supplied registry layers)
- `src/adapters/agents/registry-loader.ts` (NEW: Read registry files and keep startup failure handling at the boundary)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-008 | Test | `src/domain/agent-config.test.ts` | The suite passes |
| TR-009 | Test | `src/server/agent-registry.test.ts` | The suite passes |
| TR-010 | Test | `src/server/agent-registry.integration.test.ts` | The suite passes |
| TR-011 | Test | `src/utils/resolve-model.test.ts` | The suite passes |
| TR-012 | Test | `src/utils/resolve-agent.test.ts` | The suite passes |
| TR-013 | Test | `src/architecture.test.ts` | The suite passes |

#### Done When

```bash
pnpm exec vitest run src/domain/agent-config.test.ts src/server/agent-registry.test.ts src/server/agent-registry.integration.test.ts src/utils/resolve-model.test.ts src/utils/resolve-agent.test.ts src/architecture.test.ts
```

### Phase 4: Toolchain manifest discovery

**Files (2):**
- `src/domain/toolchain.ts` (MODIFY: Resolve the build command from supplied facts)
- `src/adapters/toolchain/manifest-discovery.ts` (NEW: Discover build manifests and preserve explicit overrides)

#### Test Strategy

| ID | Type | Target | Expected result |
|---|---|---|---|
| TR-014 | Test | `src/domain/toolchain.test.ts` | The suite passes |
| TR-015 | Test | `src/utils/toolchain-mapper.test.ts` | The suite passes |
| TR-016 | Test | `src/architecture.test.ts` | The suite passes |
| TR-017 | Test | `src/application/architecture/context.test.ts` | The suite passes |

#### Done When

```bash
pnpm exec vitest run src/domain/toolchain.test.ts src/utils/toolchain-mapper.test.ts src/architecture.test.ts src/application/architecture/context.test.ts
```

The boundary gate allows no exceptions for existing violations. Route the three discovered engine imports through the notifications adapter and verify the existing notification behavior.
