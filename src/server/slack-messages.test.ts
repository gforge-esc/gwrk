import { describe, it, expect } from "vitest";
import { MessageBuilder } from "./slack-messages.js";

describe("MessageBuilder", () => {
  const mockDispatch = {
    featureId: "003-slack",
    phaseId: "phase-01",
    backend: "gemini" as any,
    status: "running" as any,
    branchName: "feat/003-slack",
    createdAt: new Date().toISOString(),
    attempts: [],
    id: "test-id",
  };

  it("should build phaseStart message", () => {
    const msg = MessageBuilder.phaseStart(mockDispatch);
    expect(msg.text).toContain("Phase phase-01 started");
    expect(msg.blocks[0].type).toBe("header");
    expect((msg.blocks[0] as any).text.text).toContain("003-slack");
  });

  it("should build phaseComplete message with buttons", () => {
    const msg = MessageBuilder.phaseComplete(mockDispatch);
    expect(msg.text).toContain("Phase phase-01 completed");
    const actions = msg.blocks.find(b => b.type === "actions") as any;
    expect(actions.elements).toHaveLength(3);
    expect(actions.elements[0].action_id).toBe("merge_pr");
  });

  it("should build phaseFail message with error", () => {
    const msg = MessageBuilder.phaseFail(mockDispatch, "Build failed");
    expect(msg.text).toContain("Phase phase-01 failed");
    expect(JSON.stringify(msg.blocks)).toContain("Build failed");
  });

  it("should build ciResult message", () => {
    const msg = MessageBuilder.ciResult(mockDispatch, { passed: true, summary: "All tests passed" });
    expect(msg.text).toContain("CI Results");
    expect(JSON.stringify(msg.blocks)).toContain("All tests passed");
  });
});
