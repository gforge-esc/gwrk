/**
 * Module does not exist yet (RED)
 */
import type { ActionsBlock, HeaderBlock, SectionBlock } from "@slack/types";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./slack-messages.js";
import type { AgentBackend, DispatchStatus } from "./types.js";

describe("MessageBuilder", () => {
  const mockDispatch = {
    featureId: "003-slack",
    phaseId: "phase-01",
    backend: "gemini" as AgentBackend,
    status: "running" as DispatchStatus,
    branchName: "feat/003-slack",
    createdAt: new Date().toISOString(),
    attempts: [],
    id: "test-id",
  };

  it("should build phaseStart message", () => {
    const msg = MessageBuilder.phaseStart(mockDispatch);
    expect(msg.text).toContain("Phase phase-01 started");
    expect(msg.blocks[0].type).toBe("header");
    expect((msg.blocks[0] as HeaderBlock).text.text).toContain("003-slack");
  });

  it("should build phaseComplete message without buttons", () => {
    const msg = MessageBuilder.phaseComplete(mockDispatch);
    expect(msg.text).toContain("Phase phase-01 completed");
    const actions = msg.blocks.find((b) => b.type === "actions");
    expect(actions).toBeUndefined();
  });

  it("should build reviewReady message with buttons", () => {
    const msg = MessageBuilder.reviewReady(mockDispatch);
    expect(msg.text).toContain("Review ready for 003-slack");
    const actions = msg.blocks.find(
      (b) => b.type === "actions",
    ) as ActionsBlock;
    expect(actions.elements).toHaveLength(3);
    const firstElement = actions.elements[0];
    if (firstElement.type === "button") {
      expect(firstElement.action_id).toBe("merge_pr");
    }
  });

  it("should build phaseFail message with error", () => {
    const msg = MessageBuilder.phaseFail(mockDispatch, "Build failed");
    expect(msg.text).toContain("Phase phase-01 failed");
    expect(JSON.stringify(msg.blocks)).toContain("Build failed");
  });

  it("should build ciResult message", () => {
    const msg = MessageBuilder.ciResult(mockDispatch, {
      passed: true,
      summary: "All tests passed",
    });
    expect(msg.text).toContain("CI Results");
    expect(JSON.stringify(msg.blocks)).toContain("All tests passed");
  });

  it("should build batchedSummary message", () => {
    const events = [
      { type: "phase_complete", feature: "feat-1" },
      { type: "phase_fail", feature: "feat-2" },
    ];
    const msg = MessageBuilder.batchedSummary(events);
    expect(msg.text).toContain("Batched Notification Summary");
    expect(JSON.stringify(msg.blocks)).toContain("feat-1");
    expect(JSON.stringify(msg.blocks)).toContain("feat-2");
  });

  // TODO: Implement specReady in MessageBuilder (currently throws "Not implemented")
  it.todo("should build specReady message with buttons (FR-016)");

  // TODO: Implement planReady in MessageBuilder (currently throws "Not implemented")
  it.todo("should build planReady message with buttons (FR-016)");
});
