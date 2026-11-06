# 036 Implementation Plan

Implement SemVer plugin registry indexing and AGY-style plugin configuration state. Blocked: none.

## Phase 1

Points: 8

- Extend `src/engine/registry.ts` with SemVer parsing and SHA-256 lockfile digests.
- Add `generateRegistryIndex` and `doctorPlugins` to `src/engine/registry.ts`.
- Extend `src/plugins/manifest.ts` and `src/plugins/loader.ts` with `disabled` and `.gwrk/plugins.json` state.
- Add `gwrk plugin index` and `gwrk plugin doctor` to `src/commands/plugin.ts`.
- Generate `registry.json` in `gwrk-plugins` and publish `v1.0.0` to origin.
- Done-When: `npx vitest run src/engine/registry-versioning.test.ts src/plugins/loader-versioning.test.ts` exits 0.
