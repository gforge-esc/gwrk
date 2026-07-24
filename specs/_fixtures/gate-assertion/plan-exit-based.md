# Implementation Plan: Exit-Based Gate Fixture

**Purpose**: FR-003 negative fixture for 024-gate-assertion-contract. Every
source-bearing phase asserts honestly — by running the command directly so its
exit code decides pass/fail (under Layer 2's `set -e`) — and Phase 3 additionally
uses a FILE-argument `grep -q 'schemaVersion' package.json` (a bare file grep, no
pipe from a command), which is explicitly allowed by the assertion contract.

The FR-003 lint MUST return `ok: true` with zero violations here: the detection
shape `\|\s*grep\b[^|]*-q` requires a leading `|`, so neither the exit-based
commands nor the file-argument grep match. This guards against the lint
false-failing legitimate gates (SC-005).

Not a real spec: lives under `specs/_fixtures/` (excluded from vitest collection).

---

## Phases and File Structure

### Phase 1: Data layer scaffolding

**Files (1):**
- `src/lib/db/client.js` — **create** — Prisma client singleton

#### Done When
```bash
node --check src/lib/db/client.js
```

### Phase 2: Query helpers

**Files (1):**
- `src/lib/db/queries.js` — **create** — typed query helpers

#### Done When
```bash
node --check src/lib/db/queries.js
```

### Phase 3: Metric model + DB lifecycle (exit-based + file grep — all valid)

Asserts on exit codes by running the commands directly, and separately checks a
token with a bare file-argument `grep -q` reading `package.json` (not a pipe from
a command). None of these lines is the output-as-pass antipattern.

**Files (2):**
- `src/lib/db/definitions.js` — **create** — metric model definitions
- `tests/db/definitions.test.js` — **create** — model lifecycle tests

#### Test Strategy
| TR | Type | Target | Assertion |
|---|---|---|---|
| TR-201 | [integration] | `tests/db/definitions.test.js` | full model lifecycle under migrated Postgres |

#### Done When
```bash
make test:db
pnpm vitest run tests/db/definitions.test.js
grep -q 'schemaVersion' package.json
```
