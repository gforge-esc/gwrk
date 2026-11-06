/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { parseReturnedVerdict } from "../../domain/verdict.js";

export interface ReviewVerdictInput {
  agentStdout: string;
  reopenedTasks: string[];
  failedGateTasks: string[];
}

export function evaluateReviewVerdict(input: ReviewVerdictInput): {
  verdict: "GO" | "NO-GO";
  divergenceTasks: string[];
} {
  const returned = parseReturnedVerdict(input.agentStdout);
  const failedSet = new Set(input.failedGateTasks);
  const divergenceTasks = input.reopenedTasks.filter((t) => !failedSet.has(t));

  if (
    returned === "NO-GO" ||
    input.reopenedTasks.length > 0 ||
    input.failedGateTasks.length > 0
  ) {
    return { verdict: "NO-GO", divergenceTasks };
  }
  return { verdict: "GO", divergenceTasks: [] };
}
