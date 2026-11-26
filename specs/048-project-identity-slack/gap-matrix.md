# Phase 1 test coverage matrix

Phase 1 red tests cover project identity, pure routing policy and port boundaries. Twenty-two new cases fail on missing exports while three baseline cases pass. Blocked: none.

## Requirements coverage

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|---|---|---|---|---|---|
| FR-001 | Project enrollment validation and legacy path aliases | unit | src/domain/project-id.test.ts | ✅ | |
| FR-002 | Pure Slack and HTTP access authorization | unit | src/domain/slack-routing.test.ts | ✅ | |
| FR-003 | Feature thread verification and action receipt keys | unit | src/domain/slack-routing.test.ts | ✅ | |
| TR-001 | Canonical remote MD5 retention with path alias hashes | unit | src/domain/project-id.test.ts | ✅ | |
| TR-002 | Denials for unbound context, bad roles and ambiguous channels | unit | src/domain/slack-routing.test.ts | ✅ | |
| TR-003 | Click-time denials for thread mismatch and replayed receipts | unit | src/domain/slack-routing.test.ts | ✅ | |
| TR-004 | AST import and effect purity across Phase 1 modules | unit | src/domain/slack-routing.test.ts | ✅ | |

## Red baseline

| Suite | Target | Observed | Verdict |
|---|---|---|---|
| `src/domain/project-id.test.ts` | 7 new red cases | 7 failing and 3 baseline passing | Passes |
| `src/domain/slack-routing.test.ts` | 15 new red cases | 15 failing | Passes |
