# Gap Analysis: 001 CLI Core - Phase 10 (Unified Init R3)

**Date**: 2026-06-01
**Revision**: R3 Audit

## Overview

Phase 10 (Unified Init) is the cornerstone of the R3 "Project Awareness" initiative. The goal is to move from a fragmented, hardcoded onboarding flow to a project-aware interactive wizard. Current implementation is essentially a non-interactive directory scafolder with a separate `setup` command for workstation configuration.

## Findings

### 1. Unified Onboarding (US-001 R3)
- **Status**: `wrong`
- **Details**: 
    - `src/commands/init.ts` is non-interactive. It uses flags (`--github`, `--slack`) instead of an interactive prompt.
    - It lacks the discovery phase (profile detection).
    - It does not integrate workstation setup (TCC, SSH, GitHub auth).
    - No `--non-interactive` flag exists to support CI/CD or power-user flows.

### 2. Profile Auto-Detection (US-027)
- **Status**: `greenfield`
- **Details**:
    - `src/engine/profile-detector.ts` exists but is an empty stub.
    - Needs implementation of logic to detect `package.json` (pnpm/npm/yarn), `Cargo.toml` (rust), `requirements.txt/pyproject.toml` (python), `go.mod` (go), etc.
    - Needs to extract "stack" (React, Express, FastAPI) and "layout" (src vs lib, monorepo vs polyrepo).

### 3. Config Schema Extension (FR-032)
- **Status**: `missing`
- **Details**:
    - `src/utils/config.ts`'s `GwrkConfigSchema` lacks the `project.profile` object (`type`, `stack`, `layout`, `architecture`, `conventions`).

### 4. Code Cleanup & Refactoring (FR-001 R3, FR-022)
- **Status**: `wrong`
- **Details**:
    - `src/commands/setup.ts` contains the logic that needs to be absorbed into `init`.
    - `src/commands/setup-slack.ts` is a standalone command; it should be refactored into a reusable utility that `init` can call.

### 5. Task & Gate Precision
- **Status**: `wrong`
- **Details**:
    - Existing tasks T045 and T046 are too broad (violating Halving Rule). T046 covers TCC, SSH, and GH Auth in one task.
    - Gate scripts in `gates/` for Phase 10 are incorrectly mapped to old tests.

## Gap Classification

- `src/engine/profile-detector.ts` → `greenfield`
- `src/utils/config.ts` → `missing` (schema)
- `src/commands/init.ts` → `wrong` (needs interactive rewrite)
- `src/commands/setup.ts` → `missing` (to be deleted after absorption)
- `src/commands/setup-slack.ts` → `wrong` (refactor for library use)

## Decomposition Strategy (Halving Rule)

To ensure precision, Phase 10 will be decomposed into 10 focused tasks (T041-T050), splitting the broad "wizard" and "workstation" tasks into independently verifiable units.

1. Schema Extension (Config)
2. Profile Detection (Core/Types)
3. Profile Detection (Stack/Layout)
4. Slack Refactor
5. Wizard Skeleton & Welcome
6. Profile Confirmation Loop
7. Workstation: macOS TCC
8. Workstation: SSH & GH Auth
9. Non-interactive Mode & Final Scaffolding
10. Cleanup & Surface Verification
