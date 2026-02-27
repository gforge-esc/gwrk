# Data Model: 001 CLI Core

**Feature**: 001-cli-core
**Date**: 2026-02-26
**Storage**: Flat JSON/JSONL files (ADR-001)

---

## DM-001: Task State (`tasks.json`)

**Location**: `specs/<feature>/.gwrk/tasks.json`
**Scope**: Per-feature, branch-scoped

```typescript
import { z } from 'zod';

const TaskStatusSchema = z.enum(['open', 'in_progress', 'completed']);

const TaskSchema = z.object({
  id: z.string().regex(/^T\d{3}$/),            // T001, T002, ...
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  gateScript: z.string(),                       // "gates/T001-gate.sh"
  completedAt: z.string().datetime().optional(), // ISO 8601, set on completion
});

const PhaseSchema = z.object({
  id: z.string().regex(/^phase-\d{2}$/),        // phase-01, phase-02
  title: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
});

export const TaskStateSchema = z.object({
  featureId: z.string().min(1),                  // "001-cli-core"
  createdAt: z.string().datetime(),              // ISO 8601
  phases: z.array(PhaseSchema).min(1),
});

export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
```

### Example

```json
{
  "featureId": "001-cli-core",
  "createdAt": "2026-02-26T22:00:00Z",
  "phases": [
    {
      "id": "phase-01",
      "title": "Project Bootstrap & gwrk init",
      "tasks": [
        {
          "id": "T001",
          "title": "Create package.json with dependencies",
          "description": "...",
          "status": "open",
          "gateScript": "gates/T001-gate.sh"
        }
      ]
    }
  ]
}
```

---

## DM-002: History Log (`history.jsonl`)

**Location**: `.gwrk/history.jsonl` (repo-wide)
**Format**: Append-only JSONL (one JSON object per line)

```typescript
import { z } from 'zod';

export const HistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),              // ISO 8601
  featureId: z.string().min(1),
  taskId: z.string().regex(/^T\d{3}$/),
  fromStatus: z.enum(['open', 'in_progress', 'completed']),
  toStatus: z.enum(['open', 'in_progress', 'completed']),
  agentId: z.string().optional(),                // Which agent performed this
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
```

### Example

```jsonl
{"timestamp":"2026-02-26T22:15:00Z","featureId":"001-cli-core","taskId":"T001","fromStatus":"open","toStatus":"completed"}
{"timestamp":"2026-02-26T22:16:00Z","featureId":"001-cli-core","taskId":"T002","fromStatus":"open","toStatus":"in_progress","agentId":"gemini"}
```

---

## DM-003: Configuration (`.gwrkrc.json`)

**Location**: Project root `.gwrkrc.json`
**Validation**: Zod schema, fail-fast at CLI startup

```typescript
import { z } from 'zod';

const AgentBackendSchema = z.enum(['gemini', 'claude', 'codex', 'codex-cloud']);

export const GwrkConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
  }),
  agents: z.object({
    define: AgentBackendSchema,
    implement: AgentBackendSchema,
  }),
});

export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
```

### Example

```json
{
  "project": {
    "name": "gwrk"
  },
  "agents": {
    "define": "gemini",
    "implement": "codex-cloud"
  }
}
```

### Fail-Fast Behavior

```typescript
// src/utils/config.ts
export function loadConfig(projectRoot: string): GwrkConfig {
  const configPath = path.join(projectRoot, '.gwrkrc.json');
  if (!fs.existsSync(configPath)) {
    console.error('Configuration file .gwrkrc.json not found');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const result = GwrkConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Configuration error: ${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
```
