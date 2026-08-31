/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The environment failing is not the phase failing.
 *
 * gwrk already classifies GitHub's transient errors and retries them
 * (`isTransientGhError` / `checksWithRetry`). Agent dispatch had no equivalent:
 * `executeReviewWorkflow` failed the stage on any non-zero exit, so a laptop
 * sleeping mid-review killed a run that was otherwise green.
 *
 * 029 phase-03, run #5471: IMPLEMENT committed and both post-flight gates
 * passed, then the Mac slept on battery (`Entering Sleep state due to 'Sleep
 * Service Back to Sleep'`) 8m45s into CODE_REVIEW. The agent returned
 * `API Error: Your computer went to sleep mid-response.` with exit 1, the stage
 * failed, the run died, and the push of the recovered work then failed too
 * because the network had not come back.
 *
 * The distinction that matters: a review that reports NO-GO is a verdict and
 * must stand. A review that never got to report anything is an interruption and
 * is worth another attempt.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as agentUtils from "../utils/agent.js";

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));

const mockConfig = {
  cwd: "/root",
  featureId: "029-decision-records",
  phaseId: "phase-03",
  backend: "claude",
  maxIterations: 3,
};

/** The exact message the Claude CLI emits when the host sleeps mid-response. */
const SLEPT =
  "API Error: Your computer went to sleep mid-response. The response above may be incomplete.";

function orchestrator() {
  const o = new ShipOrchestrator(mockConfig as never);
  // Keep the backoff out of the suite's wall clock.
  (o as unknown as { sleep: (ms: number) => Promise<void> }).sleep = () =>
    Promise.resolve();
  return o;
}

/** Drive the shared dispatch chokepoint both review and IMPLEMENT route through. */
async function dispatch(o: ShipOrchestrator) {
  return (
    o as unknown as {
      dispatchWithFailback: (t: unknown) => Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>;
    }
  ).dispatchWithFailback({ prompt: "review", agent: "claude", env: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  } as never);
});

describe("transient agent failures", () => {
  it("retries a dispatch the host interrupted by sleeping", async () => {
    vi.mocked(agentUtils.dispatchToAgent)
      .mockResolvedValueOnce({ exitCode: 1, stdout: SLEPT, stderr: "" } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "review complete",
        stderr: "",
      } as never);

    const result = await dispatch(orchestrator());

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(agentUtils.dispatchToAgent)).toHaveBeenCalledTimes(2);
  });

  it("retries a dispatch the network interrupted", async () => {
    vi.mocked(agentUtils.dispatchToAgent)
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
        stderr: "connect ECONNRESET 140.82.121.4:443",
      } as never)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" } as never);

    const result = await dispatch(orchestrator());

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(agentUtils.dispatchToAgent)).toHaveBeenCalledTimes(2);
  });

  it("does not retry an agent that failed on its own merits", async () => {
    // A review that ran and returned a verdict must stand. Retrying it would
    // re-roll a NO-GO into a GO, which is the vacuous-green class 026/027 close.
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 1,
      stdout: "review-code-cli: NO-GO — the finding at adr.ts:125 is unfixed",
      stderr: "",
    } as never);

    const result = await dispatch(orchestrator());

    expect(result.exitCode).toBe(1);
    expect(vi.mocked(agentUtils.dispatchToAgent)).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget and returns the last failure", async () => {
    // A machine asleep for an hour must still end the run, not spin forever.
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 1,
      stdout: SLEPT,
      stderr: "",
    } as never);

    const result = await dispatch(orchestrator());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("went to sleep");
    const calls = vi.mocked(agentUtils.dispatchToAgent).mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("leaves a successful dispatch alone", async () => {
    const result = await dispatch(orchestrator());

    expect(result.exitCode).toBe(0);
    expect(vi.mocked(agentUtils.dispatchToAgent)).toHaveBeenCalledTimes(1);
  });
});
