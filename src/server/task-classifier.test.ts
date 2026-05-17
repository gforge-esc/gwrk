import { describe, expect, it } from "vitest";
import { TaskClassification, TaskType, classifyTask } from "./task-classifier";

describe("task-classifier", () => {
  it("TR-010: classifies 'implement' as 'fast'", () => {
    expect(classifyTask(TaskType.IMPLEMENT)).toBe(TaskClassification.FAST);
    expect(classifyTask("implement")).toBe(TaskClassification.FAST);
  });

  it("TR-010: classifies 'test' as 'fast'", () => {
    expect(classifyTask(TaskType.TEST)).toBe(TaskClassification.FAST);
    expect(classifyTask("test")).toBe(TaskClassification.FAST);
  });

  it("TR-010: classifies 'review' as 'thinking'", () => {
    expect(classifyTask(TaskType.REVIEW)).toBe(TaskClassification.THINKING);
    expect(classifyTask("review")).toBe(TaskClassification.THINKING);
  });

  it("TR-010: classifies 'define' as 'high-context'", () => {
    expect(classifyTask(TaskType.DEFINE)).toBe(TaskClassification.HIGH_CONTEXT);
    expect(classifyTask("define")).toBe(TaskClassification.HIGH_CONTEXT);
  });

  it("TR-010: classifies 'remediation' as 'fast'", () => {
    expect(classifyTask(TaskType.REMEDIATION)).toBe(TaskClassification.FAST);
    expect(classifyTask("remediation")).toBe(TaskClassification.FAST);
  });

  it("TR-010: defaults unknown tasks to 'fast'", () => {
    expect(classifyTask("unknown-task" as any)).toBe(TaskClassification.FAST);
  });
});
