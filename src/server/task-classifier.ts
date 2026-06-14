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
