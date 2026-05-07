import { describe, it, expect } from "vitest";
import { classifyTask, TaskType, TaskClassification } from "./task-classifier";

describe("task-classifier", () => {
  it("TR-010: classifies 'implement' as 'thinking'", () => {
    expect(classifyTask(TaskType.IMPLEMENT)).toBe(TaskClassification.THINKING);
    expect(classifyTask("implement")).toBe(TaskClassification.THINKING);
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

  it("TR-010: classifies 'remediation' as 'thinking'", () => {
    expect(classifyTask(TaskType.REMEDIATION)).toBe(TaskClassification.THINKING);
    expect(classifyTask("remediation")).toBe(TaskClassification.THINKING);
  });

  it("TR-010: defaults unknown tasks to 'thinking'", () => {
    expect(classifyTask("unknown-task" as any)).toBe(TaskClassification.THINKING);
  });
});
