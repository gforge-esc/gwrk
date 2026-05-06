## UAT: Phase 6 — NO-GO

### User Story Results
| Story | Criterion | Verdict | Notes |
|-------|-----------|---------|-------|
| US-008 | Home Tab dashboard | FAIL | Integration unverified in Docker environment due to broken environment and regressions. |

### Visual Fidelity
- No mockups exist for this feature.
- Block Kit builders for Home Tab (Active Agents, Queue, Resources, Progress, Pulse) are correct in unit tests.

### Evidence
- Unit tests `src/server/slack-home.test.ts` passed (2/2).
- 5 other tests (Phase 1 and bootstrap) failed: `src/commands/setup-slack.test.ts` (4) and `src/server/index.test.ts` (1).
- `gwrk-api` container is in a restart loop because `docker` CLI is missing from the image, causing `ensureDocker()` to fail.
- `verify-dev-stack.sh` reported "api" as running incorrectly because it doesn't check service state, only existence in JSON output.

### Next Steps
1. Install `docker-ce-cli` in `Dockerfile`.
2. Fix `src/commands/setup-slack.test.ts` to expect `console.error` and ANSI colors.
3. Mock `readline` in `setup-slack.test.ts` to avoid timeout.
4. Correctly mock `SandboxManager`/`ensureDocker` in `index.test.ts`.
5. Fix `verify-dev-stack.sh` to correctly check container status.
6. Run `/implement specs/003-slack 6` to resolve re-opened tasks.
