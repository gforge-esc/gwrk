# Implementation Plan: Legacy Format Golden Fixture

**Purpose**: Backward-compatibility regression lock for 023-plan-format-contract
(FR-004 / TC-004). Authored in the pre-canonical grammar the parser has always
supported: `####` sections, paren-form file lines `` - `path` (ACTION: desc) ``,
prose-bullet `#### Done When` bodies, and a bare-Type `#### Test Strategy` table.
The additive canonical grammar MUST NOT change how this parses.

Not a real spec: lives under `specs/_fixtures/` (excluded from vitest collection).

---

## Phases and File Structure

### Phase 1: Legacy parser support

**Files (2):**
- `src/legacy/parser.ts` (NEW: core parser)
- `src/legacy/parser.test.ts` (NEW: unit tests)

#### Test Strategy
| TR | Type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/legacy/parser.test.ts` | parser handles legacy paren-form input |

#### Done When
- All unit tests pass
- Build is clean

### Phase 2: Legacy integration

**Files (1):**
- `src/legacy/integration.ts` (MODIFY: wire parser into the pipeline)

#### Done When
- Integration test passes
