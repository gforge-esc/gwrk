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

## DM-003: Configuration (`.gwrkrc.json`)

**Location**: Project root
**Validation**: Zod schema, fail-fast at startup.

```typescript
const AgentBackendSchema = z.enum(['gemini', 'claude', 'codex']);

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
  }),
  github: z.object({
    org: z.string().min(1),
    visibility: z.enum(['public', 'private']).default('private'),
  }),
  agents: z.object({
    define: AgentBackendSchema,
    implement: AgentBackendSchema,
    // Token tracking is optional if agent does not report it
    trackTokens: z.boolean().default(true),
  }),
});
```

---

## DM-004: SQLite Execution Ledger (`~/.gwrk/gwrk.db`)

**Scope**: Global analytical ledger. WAL mode. No UPDATE/DELETE (audit trail).

### Table: `runs`
Records every agent dispatch and orchestration run.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `feature_id` | TEXT | e.g. "001-cli-core" |
| `command` | TEXT | e.g. "plan", "implement", "wud" |
| `phase_id` | TEXT | e.g. "phase-01" (optional) |
| `agent_backend` | TEXT | e.g. "gemini" |
| `workflow` | TEXT | Workflow path or shell script name |
| `exit_code` | INTEGER | Process exit code (NULL if running) |
| `duration_s` | INTEGER | Duration in seconds |
| `started_at` | DATETIME | ISO 8601 (DEFAULT CURRENT_TIMESTAMP) |

### Table: `history`
Records every task state transition for compression tracking.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `feature_id` | TEXT | e.g. "001-cli-core" |
| `task_id` | TEXT | e.g. "T001" |
| `from_status` | TEXT | Previous status |
| `to_status` | TEXT | New status |
| `agent_id` | TEXT | Optional agent identifier |
| `created_at` | DATETIME | ISO 8601 (DEFAULT CURRENT_TIMESTAMP) |

### Table: `projects`
Registration for projects managed by gwrk.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `name` | TEXT | Project name |
| `root_path` | TEXT | Absolute path to project |
| `created_at` | DATETIME | ISO 8601 |
