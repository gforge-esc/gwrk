/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface ScopedTestOutcomeInput {
  testsRun: number;
  failed: number;
  baselineFailed: number;
}

export function evaluateScopedTestOutcome(input: ScopedTestOutcomeInput): {
  passed: boolean;
  reason?: string;
} {
  if (input.testsRun === 0) {
    return { passed: false, reason: "zero tests executed (liveness failure)" };
  }
  if (input.failed > input.baselineFailed) {
    return {
      passed: false,
      reason: `test failures increased from baseline ${input.baselineFailed} to ${input.failed}`,
    };
  }
  return { passed: true };
}
