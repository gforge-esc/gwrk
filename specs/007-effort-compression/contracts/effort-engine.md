---
type: contract
feature: 007-effort-compression
last_modified: "2026-06-03T14:00:00Z"
---

# Contract: Effort Engine

**Feature**: 007-effort-compression
**Scope**: Story extraction, role bracketing, hour computation, report generation, and configuration resolution.

---

## `extractStories(specPath: string): StoryEstimate[]`

**Source**: `src/engine/spec-parser.ts`
**Consumed by**: `src/engine/effort.ts`

Parses `spec.md` and extracts all `US-###` blocks with their SP values, role assignments, and titles. Returns an array of `StoryEstimate` objects. Stories without explicit SP are flagged with `sp: 0` and `unestimated: true`.

```typescript
function extractStories(specPath: string): StoryEstimate[]
```

| Parameter | Type | Description |
|---|---|---|
| `specPath` | `string` | Absolute path to `spec.md` |

**Returns**: `StoryEstimate[]`
**Throws**: If file missing → stderr `spec.md not found for feature '<feature>'`, exit 1

### Extraction Rules

| Markdown Pattern | Extracted Field |
|---|---|
| `### US-001 - Title (Priority: P0)` | `storyId`, `title`, `priority` |
| `SP` value in story header or body | `sp` |
| Role code in story body (`RE`, `TS`, `PM`, `PE`, `DE`) | `roles[]` |

---

## `resolveRoleMultipliers(config: GwrkConfig): RoleConfig[]`

**Source**: `src/engine/roles.ts`
**Consumed by**: `src/engine/effort.ts`

Returns the active role multiplier table. If `.gwrkrc.json` contains `effort.roles.<CODE>.hoursPerSP` overrides, those take precedence. Otherwise, canonical defaults are used.

```typescript
function resolveRoleMultipliers(config: GwrkConfig): RoleConfig[]
```

### Canonical Defaults

| Role | Code | Hours/SP |
|---|---|---|
| Rust / Engine Engineer | `RE` | 6 |
| TS / Fullstack Developer | `TS` | 4 |
| Product Manager | `PM` | 2 |
| Principal Engineer | `PE` | 1.5 |
| Data / Generator Engineer | `DE` | 5 |

**Returns**: `RoleConfig[]` with merged defaults + overrides

---

## `computeEffort(stories: StoryEstimate[], roles: RoleConfig[], overheadFactor: number): EffortReport`

**Source**: `src/engine/effort.ts`
**Consumed by**: `src/commands/effort.ts`

Pure function. Takes extracted stories, resolved role multipliers, and overhead factor (default 1.25). Returns a complete `EffortReport` with role breakdowns and totals.

```typescript
function computeEffort(
  stories: StoryEstimate[],
  roles: RoleConfig[],
  overheadFactor: number
): EffortReport
```

**Returns**: `EffortReport`
**Deterministic**: Same inputs → identical output. No side effects.

---

## `writeEffortReport(report: EffortReport, outputDir: string): string`

**Source**: `src/engine/report-writer.ts`
**Consumed by**: `src/commands/effort.ts`

Generates a markdown report and writes it to `docs/assessments/effort-<featureId>-YYYY-MM-DD.md`. Returns the absolute path to the written file.

```typescript
function writeEffortReport(report: EffortReport, outputDir: string): string
```

**Returns**: Absolute path to generated report file
**Side effect**: File write to `outputDir`

---

## `effortCommand(featureId: string, options: { json?: boolean }): void`

**Source**: `src/commands/effort.ts`
**Consumed by**: `src/cli.ts`

Commander command handler. Loads config, resolves roles, extracts stories, computes effort, either writes markdown report or outputs JSON to stdout.

```typescript
function effortCommand(featureId: string, options: { json?: boolean }): void
```

**Exit codes**:
| Condition | Exit code |
|---|---|
| Success | 0 |
| spec.md not found | 1 |
| No user stories | 1 |
| Config error | 1 |

---

## `resolveEffortConfig(profile: ProjectProfile, configOverrides: GwrkConfig): EffortConfig`

**Source**: `src/utils/config.ts`
**Consumed by**: `src/engine/effort.ts`, `src/engine/compression.ts`

Implements the three-layer resolution chain for effort configuration: compiled-in defaults → project profile detection → `.gwrkrc.json` overrides. This determines the active `locPerSP` rate used for fallback SP calculation.

```typescript
function resolveEffortConfig(profile: ProjectProfile, configOverrides: GwrkConfig): EffortConfig
```

**Returns**: `EffortConfig` including resolved rates for implementation and definitional LOC.
