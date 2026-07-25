# Implementation Plan: Output-as-Pass SEAM Fixture

**Purpose**: FR-003 positive / SEAM fixture for 024-gate-assertion-contract. Its
source-bearing Phase 3 `#### Done When` pipes the command under test into
`grep -q` — the exact data-dashboard `002-metric-model` phase-03 false-green:

```
make test:db 2>&1 | grep -q 'db/definitions'
```

Under Layer 2 execution (`set -e`, no `pipefail`) this gate reports PASS even when
`make test:db` fails 0/2, because the path `db/definitions` appears in the failing
test's error text so `grep -q` matches. Layers 1 (extraction) and 2 (execution)
both did their jobs, yet the gate lies — the assertion was written against output
text, not the exit code. The `define plan` FR-003 lint MUST reject this at define
time (exit 1, phase + offending line named).

Phases 1–2 carry legitimate exit-based gates and MUST NOT be flagged; only
Phase 3 is the expected violation.

Not a real spec: lives under `specs/_fixtures/` (excluded from vitest collection).

---

## Phases and File Structure

### Phase 1: Data layer scaffolding (exit-based gate — valid)

**Files (1):**
- `src/lib/db/client.js` — **create** — Prisma client singleton

#### Done When
```bash
node --check src/lib/db/client.js
```

### Phase 2: Query helpers (exit-based gate — valid)

**Files (1):**
- `src/lib/db/queries.js` — **create** — typed query helpers

#### Done When
```bash
node --check src/lib/db/queries.js
```

### Phase 3: Metric model + DB lifecycle (SEAM — output-as-pass, must be rejected)

The source-bearing phase whose fenced-bash `#### Done When` proves success by
grepping the command's output instead of asserting on its exit code. This is the
Layer-3 defect 024 closes.

**Files (2):**
- `src/lib/db/definitions.js` — **create** — metric model definitions
- `tests/db/definitions.test.js` — **create** — model lifecycle tests

#### Test Strategy
| TR | Type | Target | Assertion |
|---|---|---|---|
| TR-101 | [integration] | `tests/db/definitions.test.js` | full model lifecycle under migrated Postgres |

#### Done When
```bash
make test:db 2>&1 | grep -q 'db/definitions'
```
