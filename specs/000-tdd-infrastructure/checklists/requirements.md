# Requirements Checklist: 000 TDD Infrastructure

**Purpose**: Gate implementation against spec requirements. Every item must be ✅ before feature is marked Done, Done!
**Created**: 2026-03-12
**Feature**: [spec.md](../spec.md)

## Gate Standard (FR-001)

- [ ] CHK-001: `grep -rl "^test -f" specs/*/gates/T*-gate.sh | wc -l` outputs `0`
- [ ] CHK-002: Every `T*-gate.sh` contains at least one of: `pnpm vitest run`, `pnpm biome check`, `pnpm tsc`, `curl`, `bash -n`
- [ ] CHK-003: `gwrk tasks done` with a failing gate exits 1 and leaves state unchanged (FR-001, US-001)
- [ ] CHK-004: Gate missing → `gwrk tasks done` exits 1 with `CRITICAL:` message

## LLM-Authored Gates (FR-002)

- [ ] CHK-005: `gwrk define tasks 003-slack --reconcile` does not overwrite any `# AUTHORED` gate
- [ ] CHK-006: Phase 7 T007 gate contains `vitest` or `curl`, not only `test -f`
- [ ] CHK-007: Phase 7 T012 gate contains `pnpm vitest run src/server/routes/notify.test.ts`
- [ ] CHK-008: `src/utils/gate-gen.test.ts` exists and passes (FR-002, TR-001, TR-010)

## Red-First Test Authoring (FR-003)

- [ ] CHK-009: `gwrk define tests 003-slack 7` produces red vitest tests before implementation
- [ ] CHK-010: Every `describe` block in phase test files references a `FR-###` ID
- [ ] CHK-011: Tests use Fastify `inject()` for API routes (not real HTTP)
- [ ] CHK-012: Tests use Vitest mocks for Slack API and GitHub API

## Contracts (FR-004)

- [ ] CHK-013: `test -f specs/003-slack/contracts/notify.md` exits 0
- [ ] CHK-014: Contract defines `NotifyPayload` interface with all required fields
- [ ] CHK-015: `pnpm tsc --noEmit` passes clean after contract types are imported in tests

## Retroactive Audit — 001-cli-core (FR-005)

- [ ] CHK-016: `test -f specs/001-cli-core/gap-analysis.md` exits 0
- [ ] CHK-017: Gap analysis classifies every FR-### from 001 spec as ✅, ⚠️, or ❌
- [ ] CHK-018: Every ❌ FR has a corresponding open task
- [ ] CHK-019: `pnpm vitest run src/commands/tasks-done.test.ts` passes (gate enforcement tested)
- [ ] CHK-020: `pnpm vitest run src/utils/config.test.ts` passes (fail-fast config tested)
- [ ] CHK-021: `pnpm vitest run src/commands/init.test.ts` passes (idempotency tested)

## Retroactive Audit — 002-build-server (FR-006)

- [ ] CHK-022: `test -f specs/002-build-server/gap-analysis.md` exits 0
- [ ] CHK-023: Gap analysis classifies every FR-### from 002 spec
- [ ] CHK-024: `pnpm vitest run src/server/routes/health.test.ts` passes
- [ ] CHK-025: `pnpm vitest run src/server/index.test.ts` passes
- [ ] CHK-026: Server lifecycle (start/stop), health endpoint, dispatch queue each have ≥1 passing test

## 003-slack Remediation (FR-007)

- [ ] CHK-027: `pnpm vitest run 2>&1 | grep -q "0 failed"` — full suite green
- [ ] CHK-028: `pnpm vitest run src/server/routes/notify.test.ts` passes
- [ ] CHK-029: `pnpm vitest run src/server/slack-actions.test.ts` passes
- [ ] CHK-030: `pnpm vitest run src/server/slack-commands.test.ts` passes
- [ ] CHK-031: Phase 7-9 gate scripts all invoke `pnpm vitest run` not `test -f`

## Forward Standard for 004-008 (FR-008)

- [ ] CHK-032: `gwrk ship 004-ship-loop phase-01` exits 1 with `[BLOCKED]` when no test files exist
- [ ] CHK-033: `src/commands/ship.ts` contains pre-flight test-file existence check
- [ ] CHK-034: `src/commands/ship.test.ts` covers the BLOCKED pre-flight case

## gwrk test Command (FR-009)

- [ ] CHK-035: `gwrk test --help` shows `<feature>` and `--phase` arguments
- [ ] CHK-036: `gwrk test 001-cli-core` exits 0 with "Tests passed" when all green
- [ ] CHK-037: `gwrk test 003-slack` exits 1 with "failed" count when tests fail
- [ ] CHK-038: `src/commands/test-cmd.test.ts` exists and passes

## Notes
- Check items off as completed: `[x]`
- Items CHK-001 through CHK-038 must all pass before Done, Done!
- Link any failures to relevant FR-### identifiers in the gap analysis
