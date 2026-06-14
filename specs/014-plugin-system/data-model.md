# Data Model: 014 Plugin System

## Zod Schemas

```typescript
// src/plugins/manifest.ts
const ExtensionManifestSchema = PluginBaseSchema.extend({
  type: z.literal('extension'),
  provides: z.array(z.enum(['context', 'metrics', 'search', 'notification'])),
  adapter: z.string(),
});

const AnyManifestSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  SkillManifestSchema,
  EnforcementSkillManifestSchema,
  WorkflowManifestSchema,
  ExtensionManifestSchema,
]);
```
