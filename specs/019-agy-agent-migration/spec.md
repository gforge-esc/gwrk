# Feature Specification: 019 agy-agent-migration

**Feature Branch**: `develop`
**Created**: 2026-06-01
**Status**: Draft
**Input**: Read and make section G a spec

---

## 2. User Scenarios & Testing

### US-001 - Dispatch via Agy Backend (Priority: P0)
Automated background agent tasks execute via `agy` instead of legacy `gemini` CLI so that automated workflows continue working post-deprecation.

**Implements**: FR-001, FR-002, FR-004

**Independent Test**: DEFERRED — End-to-end test validates dispatch.

**Acceptance Scenarios**:
1. **Given** `agy` is installed and configured as default backend, **When** I run an `agy` command with YOLO mode, **Then**:
   - `agy -p "echo hello" --dangerously-skip-permissions` exits 0

### US-002 - Agy Governance Sync (Priority: P1)
Project-scoped governance instructions persist in a format the `agy` backend expects so the agent can adhere to project norms.

**Implements**: FR-003

**Independent Test**: Unit test for AgyAdapter.syncGovernance()

**Acceptance Scenarios**:
1. **Given** a gwrk workspace with rules, **When** I trigger a governance sync, **Then**:
   - `cat AGENTS.md | grep "<!-- gwrk:begin -->"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST implement `AgyAdapter` implementing `AgentBackend` interface to interact with the `agy` CLI binary. (Implements: US-001)
- **FR-002**: System MUST default the agent backend to `agy` while retaining `gemini` for fallback backward compatibility. (Implements: US-001)
- **FR-003**: System MUST write project instructions via `AgyAdapter.syncGovernance` to `AGENTS.md` using standard gwrk markers. (Implements: US-002)
- **FR-004**: System MUST map YOLO mode to `--dangerously-skip-permissions` instead of `--approval-mode yolo` and omit the `--model` flag. (Implements: US-001)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `agy` binary not found | `command not found: agy` | `1` |
| `agy` turn limit reached | `turn_limit` | `unknown` |

---

## 5. Data Model Requirements

_No database entities required for this feature. See DM-000._

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.

---

## 7. Testing Requirements

- **TR-001**: `src/plugins/builtins/agents/agy/adapter.test.ts` — Verify command generation maps YOLO flag to `--dangerously-skip-permissions` and omits `--model`. Vitest. (FR-004)
- **TR-002**: `src/engine/router.test.ts` — Verify the router's fallback chain prioritizes `agy` over `gemini`. Vitest. (FR-002)

---

## 8. Success Criteria

- **SC-001**: `gwrk` commands dispatch correctly using `agy` as the primary backend without failing due to unrecognized flags.

---

## 9. Verification Requirements

- **VR-001**: Run an end-to-end `gwrk ship` command confirming the router uses `agy`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-004 | FR-001 | US-001 | TR-001, TR-002 |
| US-002 | FR-003 | FR-002 | US-001 | TR-002 |
| | | FR-003 | US-002 | no test — simple file write |
| | | FR-004 | US-001 | TR-001 |
