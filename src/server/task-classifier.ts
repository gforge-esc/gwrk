/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export enum TaskClassification {
  THINKING = "thinking",
  FAST = "fast",
  HIGH_CONTEXT = "high-context",
}

export enum TaskType {
  IMPLEMENT = "implement",
  TEST = "test",
  REVIEW = "review",
  DEFINE = "define",
  REMEDIATION = "remediation",
}

export function classifyTask(taskType: string | TaskType): TaskClassification {
  switch (taskType) {
    case TaskType.REVIEW:
      return TaskClassification.THINKING;
    case TaskType.IMPLEMENT:
    case TaskType.REMEDIATION:
    case TaskType.TEST:
      return TaskClassification.FAST;
    case TaskType.DEFINE:
      return TaskClassification.THINKING;
    default:
      return TaskClassification.FAST; // Default to fast — escalate explicitly
  }
}
