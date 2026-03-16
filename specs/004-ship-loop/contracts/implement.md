# Contract: validate-staging.sh — Staging Scope Validator

**Source**: `scripts/dev/validate-staging.sh`
**FRs**: FR-016

## Interface

```
./scripts/dev/validate-staging.sh <feature>
```

**Exit codes**:
| Code | Meaning |
|---|---|
| 0 | Staging scope is clean |
| 1 | Violations detected |

## Checks (ALL IMPLEMENTED)

### Check 1: Orphan Files
Rejects staged `.tmp`, `.bak`, and `=` files in repo root.

### Check 2: Orphan Spec Directories
Rejects staged changes in `specs/NNN-*` dirs that lack a `spec.md`.

### Check 3: Out-of-Scope Files
Rejects staged files outside `ALLOWED_PREFIXES`:
`src/`, `specs/<feature>/`, `docs/`, `scripts/`, `test/`, `.gwrk/`, `.gwrkrc.json`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `biome.json`, `dist/`

### Check 4: Build Plan Protection (Design Mandate Rule 3)
Rejects if `specs/000-build-plan.md` is staged.

## Integration Gap

**`validate-staging.sh` is robust and complete.** The gap is that `work-until-done.sh` never calls it (see `contracts/wud.md` FR-016 entry).

## Error States (from spec FR-016)

| Condition | stderr/stdout contains | Exit code |
|---|---|---|
| Out-of-scope files staged | `Staging validation FAILED` + `Out-of-scope file staged: <file>` | 1 |
| Build plan staged | `agents must not modify the build plan (Rule 3)` | 1 |
| Orphan spec dir | `Orphan spec dir staged (no spec.md): <dir>` | 1 |
