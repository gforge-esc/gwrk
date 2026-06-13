# Implementation Plan: 020 Polyglot Monorepo

**Branch**: `020-polyglot-monorepo` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)

## Summary

Plan to implement polyglot monorepo support by adding workspace configuration to `.gwrkrc.json`, enabling `cwd`-based profile detection, adding a `--workspace` flag to the CLI, and updating `gwrk init` to append workspaces.

---

## Phases and File Structure

### Phase 1: Configuration Schema & Profile Detection

Extend `GwrkConfigSchema` to support workspaces and implement `cwd`-based workspace detection logic.

**Files (4):**
- `src/utils/config.ts` (Modify: Add `workspaces` to `GwrkConfigSchema` and validation logic)
- `src/utils/config.test.ts` (Modify: Add TR-001 tests for valid and invalid `workspaces`)
- `src/engine/profile-detector.ts` (New: Resolve active workspace based on `cwd` vs workspace keys)
- `src/engine/profile-detector.test.ts` (New: Add TR-002 tests for `cwd` resolution)

**Requirements Addressed:** FR-001, FR-002, US-001, US-002, TC-001, TC-002, TC-003

**Dependencies:** None

**Contract Mapping:**
_No contracts mapped for this phase._

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | Always |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | unit | `src/utils/config.test.ts` | Test `GwrkConfigSchema` with valid and invalid `workspaces` |
| TR-002 | unit | `src/engine/profile-detector.test.ts` | Test `cwd` resolution to workspace profile |

#### Done When
- `pnpm vitest run src/utils/config.test.ts --grep "US-001"` exits 0
- `pnpm vitest run src/engine/profile-detector.test.ts --grep "US-002"` exits 0

---

### Phase 2: CLI Integration & Init Workspaces

Add `--workspace` flag to CLI entry and modify `init` command to append to root config when in a subdirectory.

**Files (4):**
- `src/cli.ts` (Modify: Add global `--workspace <name>` flag parsing and propagation)
- `src/cli.test.ts` (Modify: Add TR-003 tests for `--workspace` flag propagation)
- `src/commands/init.ts` (Modify: Detect existing project root and append workspace instead of new root config)
- `src/commands/init.test.ts` (Modify: Add TR-004 tests for init appending workspace)

**Requirements Addressed:** FR-003, FR-004, US-003, US-004, TC-001, TC-002, TC-003

**Dependencies:** Phase 1

**Contract Mapping:**
_No contracts mapped for this phase._

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004-agent-native-output.md | Agent-Native compliance for CLI modifications |
| workspace.md | Always |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | unit | `src/cli.test.ts` | Test `--workspace` flag propagation |
| TR-004 | unit | `src/commands/init.test.ts` | Test workspace append behavior when run in subdirectory |

#### Done When
- `pnpm vitest run src/cli.test.ts --grep "US-003"` exits 0
- `pnpm vitest run src/commands/init.test.ts --grep "US-004"` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `GwrkConfig` | `src/utils/config.ts` | `src/cli.ts`, `src/engine/profile-detector.ts`, `src/commands/init.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 2 | Planned |
| US-004 | 2 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 2 | Planned |
| FR-004 | 2 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 2 | Planned |
| TR-004 | 2 | Planned |
| DM-001 | 1 | Planned |
| TC-001 | 1 | Planned |
| TC-002 | 1 | Planned |
| TC-003 | 1 | Planned |
| SC-001 | 2 | Planned |
| SC-002 | 2 | Planned |
| SC-003 | 2 | Planned |
| VR-001 | 2 | Planned |
| VR-002 | 2 | Planned |
