---
type: data_model
feature: 001-cli-core
last_modified: "2026-03-06T00:23:51Z"
---

# Data Model: 001 CLI Core

**Feature**: 001-cli-core
**Date**: 2026-03-05
**Storage**: SQLite Execution Ledger (ADR-002) + Task State Export (Flat JSON)

---

## DM-001: Task State Export (`tasks.json`)

**Location**: `specs/<feature>/.gwrk/tasks.json`
**Scope**: Per-feature, branch-scoped. Generated from SQLite for git visibility.

```typescript
import { z } from 'zod';

const TaskStatusSchema = z.enum(['open', 'in_progress', 'completed']);

const TaskSchema = z.object({
  id: z.string().regex(/^T\d{3}$/),            // T001, T002, ...
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  gateScript: z.string(),                       // "gates/T001-gate.sh"
  completedAt: z.string().datetime().optional(), // ISO 8601
});

const PhaseSchema = z.object({
  id: z.string().regex(/^phase-\d{2}$/),        // phase-01, phase-02
  title: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
});

export const TaskStateSchema = z.object({
  featureId: z.string().min(1),
  createdAt: z.string().datetime(),
  phases: z.array(PhaseSchema).min(1),
});
```

---

## DM-002: History Log Export (`history.jsonl`)

**Location**: `.gwrk/history.jsonl`
**Scope**: Project-wide. Append-only export from SQLite `history` table.

```typescript
export const HistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),
  featureId: z.string().min(1),
  taskId: z.string().regex(/^T\d{3}$/),
  fromStatus: z.enum(['open', 'in_progress', 'completed']),
  toStatus: z.enum(['open', 'in_progress', 'completed']),
  agentId: z.string().optional(),
});
```

---

## DM-003: Configuration (`.gwrkrc.json`) ⭐ **EXTENDED (R3)**

**Location**: Project root
**Validation**: Zod schema, fail-fast at startup.

```typescript
const AgentBackendSchema = z.string();

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    githubRepo: z.string().optional(),
    // R3: Project Profile (all optional — auto-detected if missing)
    type: z.string().optional(),
    stack: z.object({
      language: z.string().optional(),
      framework: z.string().optional(),
      buildSystem: z.string().optional(),
      testFramework: z.string().optional(),
      packageManager: z.string().optional(),
    }).optional(),
    layout: z.object({
      sourceRoot: z.string().optional(),
      apps: z.string().optional(),
      packages: z.string().optional(),
      specs: z.string().optional(),
      docs: z.string().optional(),
    }).optional(),
    architecture: z.object({
      doc: z.string().optional(),
      decisions: z.string().optional(),
    }).optional(),
    conventions: z.object({
      branchPrefix: z.string().optional(),
      testPattern: z.string().optional(),
    }).optional(),
  }),
  agents: z.object({
    define: AgentBackendSchema.default("gemini"),
    implement: AgentBackendSchema.default("gemini"),
  }),
});
```

---

## DM-004: SQLite Execution Ledger (`~/.gwrk/gwrk.db`) ⭐ **SCOPED (R3)**

**Scope**: Global analytical ledger. WAL mode. Isolated by `project_id`.

### Table: `runs` (Updated R3)
Records every agent dispatch and orchestration run.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | |
| `project_id` | TEXT | MD5 hash of project root |
| `feature_id` | TEXT | |
| `command` | TEXT | |
| ... | ... | |

### New Tables (Migration 009)
`plan_features`, `plan_phases`, `plan_edges`, `plan_proposals`, `gate_results`, `compression`, `issues`, `routing_history`. All include `project_id`.

---

## DM-005: Execution Manifest (`specs/<feature>/.gwrk/runs/*.json`) ⭐ **NEW (R3)**

Git-tracked structured JSON per agent run.

```typescript
export const ExecutionManifestSchema = z.object({
  runId: z.string(),
  feature: z.string(),
  phase: z.string(),
  command: z.string(),
  agent: z.string(),
  model: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationS: z.number(),
  exitCode: z.number(),
  attempt: z.number(),
  gitCommit: z.string(),
  gitBranch: z.string(),
});
```
