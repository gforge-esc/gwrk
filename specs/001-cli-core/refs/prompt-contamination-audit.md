# Prompt Contamination Audit — 2026-05-29

Source: Skills-connection 049-companion-guidance field failure.
Method: `grep -c` for gwrk-native references across all 15 workflow PROMPT.md files.

## Contamination by Workflow

| Workflow | gwrk-native refs | Severity | Specific hardcoded items |
|----------|-----------------|----------|--------------------------|
| gwrk-plan | 26 | 🔴 Critical | Commander.js, Fastify, SQLite, `src/` layout, ADR-004, agent-native protocol, `docs/architecture.md`, `specs/000-build-plan.md`, `docs/reference/agent-native-cli.md` |
| gwrk-specify | 21 | 🟢 Fixed | Conditional guards added 2026-05-29 (tactical) |
| gwrk-review-uat | 13 | 🔴 Critical | "gwrk is a CLI tool" L37, gwrk command taxonomy L67-73, `gwrk specify` correction L165 |
| gwrk-constitution | 10 | 🟡 Medium | gwrk governance docs |
| gwrk-author-gates | 7 | 🔴 Critical | `projectType: "gwrk-typescript"` L44, ADR-004 error navigation, vitest-only gate patterns |
| gwrk-review-code | 6 | 🟡 Medium | gwrk-specific review patterns |
| gwrk-plan-to-tasks | 5 | 🟡 Medium | gwrk task structure assumptions |
| gwrk-analyze | 4 | 🟡 Low | Cross-artifact check references gwrk files |
| gwrk-cascade-sync | 3 | 🟡 Low | Build plan references |
| gwrk-define-tests | 3 | 🟡 Medium | Test patterns assume gwrk structure |
| gwrk-implement | 3 | 🟡 Low | `pnpm build` assumption, shared Zod schema warning |
| gwrk-build-plan | 1 | 🟢 Low | Incidental |
| gwrk-checklist | 1 | 🟢 Low | Incidental |
| gwrk-effort | 1 | 🟢 Low | Incidental |
| gwrk-research | 1 | 🟢 Low | Incidental |

## Top 3 Offenders — Line-Level Audit

### gwrk-plan/PROMPT.md (26 references)
- L10: `Reference existing project structure from docs/architecture.md`
- L25-51: Entire `<architecture_reference>` block (Commander.js, Fastify, SQLite, source layout)
- L29: ADR-004 agent-native output protocol mandated
- L40-44: SQLite + better-sqlite3 + WAL mode + schema management
- L74-77: Hardcoded `docs/architecture.md`, `specs/000-build-plan.md`, `docs/reference/agent-native-cli.md`, ADR-004
- L106-113: Governance table references gwrk-specific files (`.gwrk/rules/`, `docs/decisions/`)
- L122-129: "Use the gwrk source layout for file paths" — literally mandates gwrk's directory structure
- L137: Agent-Native compliance mandated for all new commands

### gwrk-review-uat/PROMPT.md (13 references)
- L37: "gwrk is a CLI tool. No Docker, no web server."
- L67-73: gwrk command taxonomy tested as acceptance criteria
- L165: "Do not use `gwrk specify`" — gwrk naming correction

### gwrk-author-gates/PROMPT.md (7 references)
- L5: `ADR: ADR-005 (TDD Gate Architecture)`
- L44: `projectType: "gwrk-typescript"` hardcoded
- L80: ADR-004 §2.4 diagnostic message requirement
- L82: "Assertion patterns by file type (all use ... for ADR-004 error navigation)"

## Observed Field Failure (049-companion-guidance)

In skills-connection (a pnpm monorepo with `apps/`, `packages/`, `experiments/`), `gwrk define plan` produced:

- `bin/gwrk generate-companion` — gwrk binary invocation in a project that has no `bin/gwrk`
- `ADR-004 Agent-Native Output` protocol references — project has no ADRs
- `--agent` / `--format json` flags — gwrk orchestration patterns in a human CLI tool
- `signal.ts` — gwrk signal module referenced
- `src/commands/` file paths — directory doesn't exist in the monorepo

All artifacts were functionally unusable for implementation.
