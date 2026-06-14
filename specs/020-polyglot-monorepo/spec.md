---
type: specification
feature: 020-polyglot-monorepo
last_modified: "2026-06-13T00:00:00Z"
revision: 1
---

# Feature Specification: 020 Polyglot Monorepo

**Feature Branch**: `020-polyglot-monorepo`
**Created**: 2026-06-13
**Status**: Active
**Input**: Polyglot monorepo support — workspace detection, per-workspace enforcement routing, config schema extensions. See R010.
**Dependencies**: R007 (profile detection — shipped), 001-P10 (schema extension — overlapping scope, see notes below)
**Existing Code**: `src/engine/profile-detector.ts` (R007, root-level detection), `src/utils/config.ts` (has `stack.languages` array)

---

## 1. Design Decisions

### Monorepo Workspaces
Currently, gwrk assumes a single tech stack per project via `.gwrkrc.json`. In a polyglot monorepo, each directory needs its own stack profile. We will extend `GwrkConfigSchema` to support a `workspaces` dictionary, mapping workspace names to their specific project profiles.

### Resolution Hierarchy
When running a command, gwrk will determine the active workspace:
1. Explicit `--workspace <name>` flag.
2. If omitted, find the closest workspace matching `cwd`.
3. If no workspace matches, fallback to the root project profile.

---

## 2. User Scenarios & Acceptance Criteria

### US-001 - Workspace Configuration (P0)
As a PE, I want to define multiple workspaces in `.gwrkrc.json` with different tech stacks, so that gwrk knows my frontend is TypeScript and my backend is Rust.

**Implements**: FR-001

**Acceptance**:
1. **Given** a `.gwrkrc.json` with `workspaces: { "web": { "stack": { "language": "typescript" } } }`, **When** validated, **Then** `cat .gwrkrc.json | jq -e '.workspaces.web' > /dev/null` exits 0.
2. **Given** a missing or invalid workspace definition, **When** validated, **Then** `gwrk project info` exits 1 with a configuration error.

### US-002 - Workspace Detection via CWD (P0)
As a developer, I want gwrk to automatically use the correct workspace profile based on my current directory, so I don't have to pass flags constantly.

**Implements**: FR-002

**Acceptance**:
1. **Given** `cd apps/web`, **When** running `gwrk project info`, **Then** `gwrk project info --format json | jq -e '.stack.language == "typescript"' > /dev/null` exits 0.
2. **Given** `cd crates/backend`, **When** running `gwrk project info`, **Then** `gwrk project info --format json | jq -e '.stack.language == "rust"' > /dev/null` exits 0.

### US-003 - Explicit Workspace Flag (P1)
As a CI system, I want to explicitly pass `--workspace <name>` to gwrk commands, ensuring deterministic profile selection.

**Implements**: FR-003

**Acceptance**:
1. **Given** the root directory, **When** running `gwrk project info --workspace web`, **Then** `gwrk project info --workspace web --format json | jq -e '.stack.language == "typescript"' > /dev/null` exits 0.
2. **Given** an invalid workspace name, **When** running `gwrk project info --workspace unknown`, **Then** `gwrk project info --workspace unknown 2>&1 | grep "Workspace not found"` exits 1.

### US-004 - Workspace Init (P1)
As a PE, I want `gwrk init` in a subdirectory to auto-detect and append a workspace entry to the root `.gwrkrc.json`.

**Implements**: FR-004

**Acceptance**:
1. **Given** a project root with gwrk configured, **When** running `cd apps/new-app && gwrk init --non-interactive`, **Then** `cat ../../.gwrkrc.json | jq -e '.workspaces["apps/new-app"]' > /dev/null` exits 0.

---

## 3. Functional Requirements

- **FR-001**: Extend `GwrkConfigSchema` to include a `workspaces` Record<string, ProjectProfile>. (US-001)
- **FR-002**: Resolve active workspace profile by comparing `cwd` against workspace keys. (US-002)
- **FR-003**: All feature-scoped commands MUST accept a `--workspace <name>` option. (US-003)
- **FR-004**: `gwrk init` MUST detect if it is running inside an existing gwrk project and prompt to add a new workspace profile. (US-004)

### Error States

| FR | Condition | stderr contains | Exit code |
|---|---|---|---|
| FR-001 | Invalid workspace schema | `Configuration error:` | 1 |
| FR-003 | `--workspace` flag with non-existent name | `Workspace not found` | 1 |

---

## 4. Data Model

### DM-001: Workspace Configuration

```typescript
interface GwrkConfig {
  project: { ... };
  workspaces?: Record<string, {
    stack?: { ... };
    layout?: { ... };
    architecture?: { ... };
    conventions?: { ... };
  }>;
}
```

---

## 5. Technical Constraints

- **TC-001**: Air-Gapped. No network calls.
- **TC-002**: Fail-Fast Config. Missing config -> `process.exit(1)`.
- **TC-003**: TypeScript Only.

---

## 6. Testing Requirements

- **TR-001**: `src/utils/config.test.ts` — test `GwrkConfigSchema` with valid and invalid `workspaces`.
- **TR-002**: `src/engine/profile-detector.test.ts` — test `cwd` resolution to workspace profile.
- **TR-003**: `src/cli.test.ts` — test `--workspace` flag propagation.
- **TR-004**: `src/commands/init.test.ts` — test workspace append behavior when run in subdirectory.

---

## 7. Success Criteria

- **SC-001**: `gwrk project info` correctly resolves workspace profiles in a polyglot setup.
- **SC-002**: `pnpm test` passes with 100% of tests GREEN.
- **SC-003**: `pnpm run build` compiles clean with zero TypeScript errors.

---

## 8. Verification Requirements

- **VR-001**: E2E: create polyglot repo, run `gwrk init` in subdirectories, verify `.gwrkrc.json`.
- **VR-002**: E2E: run `gwrk project info` inside each workspace, verify output matches workspace profile.

---

## 9. Coverage Matrix

| US | FR | TR |
|---|---|---|
| US-001 | FR-001 | TR-001 |
| US-002 | FR-002 | TR-002 |
| US-003 | FR-003 | TR-003 |
| US-004 | FR-004 | TR-004 |
