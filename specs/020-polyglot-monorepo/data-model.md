# Data Model: 020 Polyglot Monorepo

## Schema Definitions

### DM-001: Workspace Configuration

```typescript
import { z } from "zod";

export const WorkspaceConfigSchema = z.object({
  stack: z.object({
    language: z.string().optional(),
    buildSystem: z.string().optional(),
  }).optional(),
  layout: z.object({
    type: z.string().optional(),
  }).optional(),
  architecture: z.object({}).optional(),
  conventions: z.object({}).optional(),
});

export const GwrkConfigSchema = z.object({
  project: z.object({
    // Existing project fields...
  }),
  workspaces: z.record(z.string(), WorkspaceConfigSchema).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
```
