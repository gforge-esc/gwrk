# Data Model: 001 CLI Core

This feature uses flat-file JSON state stored in `specs/<feature>/.gwrk/tasks.json` to track implementation progress.

## tasks.json Schema

The `tasks.json` file is a collection of phases, each containing multiple tasks.

### Types (Zod)

```typescript
import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.string(), // e.g., "T001"
  title: z.string(),
  description: z.string(),
  status: z.enum(['open', 'completed']),
  gate: z.string(), // path to gate script, e.g., "gates/T001-gate.sh"
  assertions: z.array(z.string()),
});

export const PhaseSchema = z.object({
  id: z.number(), // e.g., 1
  title: z.string(),
  description: z.string(),
  tasks: z.array(TaskSchema),
});

export const TaskStateSchema = z.object({
  featureId: z.string(),
  phases: z.array(PhaseSchema),
});

export const HistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),
  featureId: z.string(),
  taskId: z.string(),
  fromStatus: z.enum(['open', 'completed']),
  toStatus: z.enum(['open', 'completed']),
  agentId: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
```

### File Structure Example

#### tasks.json

```json
{
  "featureId": "001-cli-core",
  "phases": [
    {
      "id": 1,
      "title": "CLI Bootstrap",
      "description": "...",
      "tasks": [
        {
          "id": "T001",
          "title": "...",
          "description": "...",
          "status": "open",
          "gate": "gates/T001-gate.sh",
          "assertions": ["..."]
        }
      ]
    }
  ]
}
```

#### history.jsonl

```json
{"timestamp": "2026-02-26T22:00:00Z", "featureId": "001-cli-core", "taskId": "T001", "fromStatus": "open", "toStatus": "completed", "agentId": "gemini-1.5-pro"}
```
