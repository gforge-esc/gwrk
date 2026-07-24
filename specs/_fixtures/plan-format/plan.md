# Implementation Plan: Plan-Format SEAM Fixture

**Purpose**: Canonical-format fixture for 023-plan-format-contract. Authored in the
canonical format (em-dash file lines + fenced-bash `#### Done When` blocks +
Type-flexible Test Strategy). Phase 3 mirrors the data-dashboard `002-metric-model`
phase-03 false-green case (em-dash files + fenced-bash `make test:db` gate) — the
exact shape that must resolve to an executable gate, not an `echo "Phase N"` stub.

Not a real spec: lives under `specs/_fixtures/` (excluded from vitest collection).

---

## Phases and File Structure

### Phase 1: Data layer scaffolding

Two em-dash file lines with distinct actions — proves em-dash extraction and the
create→new-file / amend→modify task derivation (a phase built entirely from em-dash
lines must NOT collapse to the phase-title last-resort stub).

**Files (2):**
- `src/lib/db/client.js` — **create** — Prisma client singleton
- `src/lib/db/models.js` — **amend** — add the metric model

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

### Phase 3: Metric model + DB lifecycle (SEAM — mirrors 002-metric-model phase-03)

The source-bearing phase whose fenced-bash `#### Done When` must compile verbatim
into the phase gate (`make test:db`), never the `echo "Phase 3"` stub. The
`[integration]` Test Strategy row's backticked target must land in `phase.testTargets`.

**Files (2):**
- `src/lib/db/lifecycle.js` — **create** — migration + lifecycle wiring
- `tests/db/definitions.test.js` — **create** — model lifecycle tests

#### Test Strategy
| TR | Type | Target | Assertion |
|---|---|---|---|
| TR-101 | [integration] | `tests/db/definitions.test.js` | full model lifecycle under migrated Postgres |

#### Done When
```bash
make dev:up && make db:migrate && make test:db
```
