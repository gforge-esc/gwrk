/**
 * E2E tests for ship loop infrastructure.
 *
 * LIFECYCLE NOTE (2026-05-06):
 * The original bash ship loop (work-until-done.sh, wud-branch.sh) was replaced
 * by the TypeScript ShipOrchestrator in 004-ship-loop Phase 3.
 *
 * Coverage migration:
 *   FR-002 (branch setup)        → src/engine/ship-orchestrator.test.ts
 *   FR-003 (pre-flight gates)    → src/engine/ship-orchestrator.test.ts
 *   FR-005 (NO-GO retry)         → src/engine/ship-orchestrator.test.ts
 *   FR-006 (PR creation)         → src/commands/ship.test.ts
 *   FR-007 (circuit breaker)     → src/engine/ship-orchestrator.test.ts
 *   FR-008 (crash recovery)      → src/commands/ship.test.ts
 *   FR-016 (staging validation)  → src/engine/ship-orchestrator.test.ts (planned)
 *   FR-017 (execution manifest)  → src/commands/ship.test.ts (FR-012/T003)
 *
 * The only surviving RED test from the original E2E suite is FR-018/T007
 * (circuit breaker failureContext), which is still unimplemented.
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MOCKS_DIR = path.join(ROOT, ".test-mocks-ship");
const SPEC_DIR = path.join(ROOT, "specs/999-ship-e2e");

const mockWrapper = (scriptName: string, content: string) => {
  const file = path.join(MOCKS_DIR, scriptName);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${content}\n`);
  fs.chmodSync(file, "755");
  return file;
};

const cleanupState = () => {
  const RUNS_DIR = path.join(ROOT, ".test-runs-e2e");
  if (fs.existsSync(RUNS_DIR)) fs.rmSync(RUNS_DIR, { recursive: true, force: true });
  if (fs.existsSync(SPEC_DIR)) fs.rmSync(SPEC_DIR, { recursive: true, force: true });
};

// ─── FR-018/T007: Circuit Breaker failureContext ──────────────────
// RED: This is a legitimate unimplemented feature in the TypeScript
// ShipOrchestrator. When CIRCUIT_BREAK triggers, the state file
// should contain structured failureContext per spec DM-001.

describe("FR-018/T007: Circuit Breaker failureContext", () => {
  let env: Record<string, string>;
  beforeAll(() => {
    cleanupState();
    fs.mkdirSync(MOCKS_DIR, { recursive: true });
    fs.mkdirSync(SPEC_DIR, { recursive: true });
    env = {
      ...process.env,
      PATH: `${MOCKS_DIR}:${process.env.PATH}`,
      MAX_ITERATIONS: "1",
      RUNS_DIR: path.join(ROOT, ".test-runs-e2e"),
      AGENT_RUNNER_BIN: mockWrapper("failing-agent.sh", "exit 42"),
      WUD_BRANCH_BIN: mockWrapper("ship-branch.sh", "echo 'mock branch'"),
      WUD_VERDICT_BIN: mockWrapper("ship-verdict.sh", "exit 0"),
      WUD_CI_WAIT_BIN: mockWrapper("ship-ci-wait.sh", "exit 0"),
      VALIDATE_STAGING_BIN: mockWrapper("validate-staging.sh", "exit 0"),
    };
    mockWrapper("gh", "echo '1234'");
    mockWrapper("gwrk", "exit 0");
    mockWrapper("git", [
      'if [[ "$1" == "status" && "$2" == "--porcelain" ]]; then exit 0; fi',
      'if [[ "$1" == "branch" ]]; then echo "feat/999-ship-e2e"; exit 0; fi',
      'echo "mock git"',
    ].join("\n"));
  });

  // RED: Circuit breaker failureContext population not yet implemented in ShipOrchestrator
  it.todo("FR-018/T007: produces non-empty failureContext in the JSON state file on CIRCUIT_BREAK");
});
