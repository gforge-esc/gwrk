# Data Model: 003 Slack

## SQLite Schema

The `runs` table is extended to track Pull Requests associated with feature phases. This enables the `/gwrk approve` slash command and Slack interactive buttons to resolve and merge the correct PR.

### Migration: `002_pr_tracking.sql`

```sql
-- Add PR tracking to runs table
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
```

## Zod Schemas

### Slack Project Configuration (`.gwrkrc.json`)

Defined in `src/utils/config.ts`.

```typescript
export const GwrkConfigSchema = z.object({
  project: z.object({
    // ...
    slack: z
      .object({
        channelId: z.string(),          // Per-project channel ID
        channelName: z.string().optional(),
        webhookUrl: z.string().url().optional(), // Primary notify path
        opsChannelId: z.string().optional(),     // Master channel ID
        opsChannelName: z.string().optional(),
      })
      .optional(),
  }),
  // ...
});
```

### Notification Payload (`POST /api/notify`)

Defined in `src/server/types.ts`.

```typescript
export interface NotifyPayload {
  type:
    | "phase_start"
    | "phase_complete"
    | "phase_fail"
    | "ci_result"
    | "review_ready"
    | "done_done"
    | "define_spec_ready"   // v3
    | "define_plan_ready";  // v3
  feature: string;
  phase?: string;
  backend?: string;
  branch?: string;
  error?: string;
  gateResults?: string;
  prUrl?: string;
  prNumber?: number;
  opsOnly?: boolean;
  specPath?: string;    // For define_spec_ready
  planPath?: string;    // For define_plan_ready
  phaseCount?: number;  // For define_plan_ready
}
```

### Slack Event (Internal)

Defined in `src/server/slack-presence.ts`.

```typescript
export interface SlackEvent {
  type: NotifyPayload["type"];
  feature: string;
  phase?: string;
  opsOnly?: boolean;
  payload: Record<string, unknown>;
  timestamp: string;
}
```
