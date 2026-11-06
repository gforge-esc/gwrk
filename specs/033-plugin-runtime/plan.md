# 033 — Implementation Plan

## Phases

### Phase 1 — Skill Seeding, SKILL.md Loading, Dynamic Agent Plugins, and NotificationPort (8 SP)
- `src/plugins/manifest.ts` (MODIFY: Default `preferredModel` to `"default"`)
- `src/plugins/seed.ts` (MODIFY: Include `preferredModel` in seeded manifests)
- `src/plugins/skill-runtime.ts` (MODIFY: Load `SKILL.md` in `assemblePrompt`)
- `src/plugins/agent-registry.ts` (MODIFY: Dynamically import user agent plugins)
- `src/engine/registry.ts` (MODIFY: Support Git URLs, local paths, recursive copy, and `.gwrk-source.json`)
- `src/ports/notification-port.ts` (NEW: Define `NotificationPort` and channel adapters)

#### Done When
```bash
pnpm vitest run src/plugins/ src/engine/registry.test.ts
```
