# Data Model: 018 Build Plan Orchestrator

## SQLite Schema

```sql
-- plan_features (DM-018-001)
CREATE TABLE IF NOT EXISTS plan_features (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PLANNED',
  sp_total    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- plan_phases (DM-018-002)
CREATE TABLE IF NOT EXISTS plan_phases (
  id            TEXT PRIMARY KEY,
  feature_id    TEXT NOT NULL REFERENCES plan_features(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PLANNED',
  health        TEXT NOT NULL DEFAULT 'CLEAN',
  sp_estimate   INTEGER NOT NULL DEFAULT 0,
  sp_actual     INTEGER,
  duration_ms   INTEGER,
  completed_at  TEXT,
  evidence      TEXT,                -- path to execution manifest or PR URL
  seq           INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_phases_feature ON plan_phases(feature_id);
CREATE INDEX IF NOT EXISTS idx_plan_phases_status ON plan_phases(status);

-- plan_edges (DM-018-003)
CREATE TABLE IF NOT EXISTS plan_edges (
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  edge_type   TEXT NOT NULL,          -- DEPENDS_ON, CONTAINS, SEQUENCE, INVALIDATES
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE INDEX IF NOT EXISTS idx_plan_edges_from ON plan_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_plan_edges_to ON plan_edges(to_id);

-- plan_proposals (DM-018-004)
CREATE TABLE IF NOT EXISTS plan_proposals (
  id                TEXT PRIMARY KEY,
  target_phase_id   TEXT NOT NULL REFERENCES plan_phases(id),
  proposal_type     TEXT NOT NULL,    -- SP_ADJUSTMENT, STATUS_CHANGE, NEW_PHASE, REWORK
  detail            TEXT,
  source            TEXT,             -- agent name or "pm"
  status            TEXT NOT NULL DEFAULT 'PENDING',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_plan_proposals_phase ON plan_proposals(target_phase_id);
CREATE INDEX IF NOT EXISTS idx_plan_proposals_status ON plan_proposals(status);
```

## Zod Schemas

```typescript
import { z } from 'zod';

// --- Status Enums ---

export const PlanPhaseStatusSchema = z.enum([
  'PLANNED',       // Exists in graph, no spec
  'SPECIFIED',     // spec.md exists
  'DEFINED',       // plan.md + tasks.json exist
  'IN_PROGRESS',   // gwrk ship started
  'SHIPPED',       // gwrk ship completed (all tasks done)
  'VERIFIED',      // Gates pass, code review GO
  'DONE',          // PM accepts (only PM can set)
  'REWORK',        // Re-opened after SHIPPED/VERIFIED
]);
export type PlanPhaseStatus = z.infer<typeof PlanPhaseStatusSchema>;

export const PlanFeatureStatusSchema = z.enum([
  'PLANNED', 'SPECIFIED', 'DEFINED', 'IN_PROGRESS',
  'SHIPPED', 'VERIFIED', 'DONE', 'REWORK',
]);
export type PlanFeatureStatus = z.infer<typeof PlanFeatureStatusSchema>;

export const PlanPhaseHealthSchema = z.enum(['CLEAN', 'DRIFTED', 'STALE', 'BLOCKED']);
export type PlanPhaseHealth = z.infer<typeof PlanPhaseHealthSchema>;

export const PlanEdgeTypeSchema = z.enum([
  'DEPENDS_ON',    // Hard prerequisite — cannot start until predecessor DONE
  'CONTAINS',      // Feature-phase containment
  'SEQUENCE',      // Phase ordering within a feature
  'INVALIDATES',   // Rework edge — research invalidates completed work
]);
export type PlanEdgeType = z.infer<typeof PlanEdgeTypeSchema>;

// --- Entity Schemas ---

export const PlanFeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: PlanFeatureStatusSchema,
  sp_total: z.number().int().nonnegative(),
});

export const PlanPhaseSchema = z.object({
  id: z.string(),
  feature_id: z.string(),
  name: z.string(),
  status: PlanPhaseStatusSchema,
  health: PlanPhaseHealthSchema,
  sp_estimate: z.number().int().nonnegative(),
  sp_actual: z.number().int().nonnegative().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  completed_at: z.string().optional(),
  evidence: z.string().optional(),
  seq: z.number().int().nonnegative(),
});

export const PlanEdgeSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  edge_type: PlanEdgeTypeSchema,
});

export const PlanProposalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type PlanProposalStatus = z.infer<typeof PlanProposalStatusSchema>;

export const PlanProposalSchema = z.object({
  id: z.string(),
  target_phase_id: z.string(),
  proposal_type: z.enum(['SP_ADJUSTMENT', 'STATUS_CHANGE', 'NEW_PHASE', 'REWORK']),
  detail: z.string().optional(),
  source: z.string().optional(),
  status: PlanProposalStatusSchema,
});

// --- Readiness (FR-018) ---

export const ReadinessLevelSchema = z.union([
  z.literal(0),  // L0: directory only → PLANNED
  z.literal(1),  // L1: has spec.md → SPECIFIED
  z.literal(2),  // L2: has spec.md + plan.md → DEFINED (partial)
  z.literal(3),  // L3: has spec.md + plan.md + tasks.json → DEFINED
]);
export type ReadinessLevel = z.infer<typeof ReadinessLevelSchema>;

export const ReadinessResultSchema = z.object({
  featureId: z.string(),
  level: ReadinessLevelSchema,
  status: PlanPhaseStatusSchema,
  hasSpec: z.boolean(),
  hasPlan: z.boolean(),
  hasTasks: z.boolean(),
  spTotal: z.number().int().nonnegative().nullable(),
});
export type ReadinessResult = z.infer<typeof ReadinessResultSchema>;

// --- Verify (FR-006) ---

export const PlanVerifyResultSchema = z.object({
  phaseId: z.string(),
  health: PlanPhaseHealthSchema,
  details: z.string(),
});
export type PlanVerifyResult = z.infer<typeof PlanVerifyResultSchema>;
```

## Edge Type Semantics

| Edge Type | Meaning | Stored? | Example |
|-----------|---------|---------|---------|
| `DEPENDS_ON` | Hard prerequisite — cannot start until predecessor DONE | ✅ Stored | F005 → F014-R |
| `CONTAINS` | Feature-phase containment | ✅ Stored | F014 → F014-P1 |
| `SEQUENCE` | Phase ordering within a feature | ✅ Stored | F014-P1 → F014-P2 |
| `INVALIDATES` | Rework — research invalidates completed work | ✅ Stored | R004 → F014-P6 |
| `BLOCKS` | Inverse of DEPENDS_ON | ❌ Computed | F014-R blocks F005 |

## Status FSM

```
PLANNED → SPECIFIED → DEFINED → IN_PROGRESS → SHIPPED → VERIFIED → DONE
                                      ↑                      |
                                      └────── REWORK ←───────┘
```

Only PM can transition to `DONE`. `REWORK` reopens a phase after `SHIPPED` or `VERIFIED`.
