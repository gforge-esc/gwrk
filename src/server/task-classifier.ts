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
    case TaskType.IMPLEMENT:
    case TaskType.REVIEW:
    case TaskType.REMEDIATION:
      return TaskClassification.THINKING;
    case TaskType.TEST:
      return TaskClassification.FAST;
    case TaskType.DEFINE:
      return TaskClassification.HIGH_CONTEXT;
    default:
      return TaskClassification.THINKING; // Default to thinking for safety
  }
}
