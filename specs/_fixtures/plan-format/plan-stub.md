# Implementation Plan: Stub-Gate Negative Fixture

**Purpose**: FR-006 negative fixture for 023-plan-format-contract. Three
source-bearing phases that exercise the three classifications the plan-gate
validator must distinguish:

- **Phase 1** — fenced-bash executable gate → NOT a violation.
- **Phase 2** — an honest *failing* gate authored in bash (`exit 1`,
  `unauthoredGate` shape) → NOT a violation (an honest RED gate is truthful, not hollow).
- **Phase 3** — prose-only `#### Done When`, no fenced-bash block → resolves to a
  hollow stub gate → the ONLY expected violation. This is the false-green shape
  `gwrk define plan` must reject (US-006 AC1).

Not a real spec: lives under `specs/_fixtures/` (excluded from vitest collection).

---

## Phases and File Structure

### Phase 1: Scaffolding (executable gate — valid)

**Files (1):**
- `src/lib/db/client.js` — **create** — Prisma client singleton

#### Done When
```bash
node --check src/lib/db/client.js
```

### Phase 2: Lifecycle (honest failing gate — valid, not hollow)

**Files (1):**
- `src/lib/db/lifecycle.js` — **create** — migration + lifecycle wiring

#### Done When
```bash
echo "TODO: author the real DB lifecycle test"; exit 1
```

### Phase 3: DB lifecycle gate (prose-only Done When — STUB, must be rejected)

**Files (2):**
- `src/lib/db/definitions.js` — **create** — metric model definitions
- `tests/db/definitions.test.js` — **create** — model lifecycle tests

#### Done When
- Migrations apply cleanly
- The metric model round-trips through Postgres
