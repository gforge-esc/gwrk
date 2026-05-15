/**
 * Module does not exist yet (RED)
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipBridge } from "./ship-bridge.js";
import { notifySlack } from "./slack-notify.js";
import { MessageBuilder } from "./slack-messages.js";

vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn(),
}));

vi.mock("./slack-messages.js", () => ({
  MessageBuilder: {
    reviewReady: vi.fn().mockReturnValue({ text: "Review Ready" }),
    phaseFail: vi.fn().mockReturnValue({ text: "Phase Fail" }),
    specReady: vi.fn().mockReturnValue({ text: "Spec Ready" }), // Not implemented yet
  },
}));

describe("ShipBridge (FR-005, FR-006)", () => {
  let mockOrchestrator: EventEmitter;
  let bridge: ShipBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrchestrator = new EventEmitter();
    bridge = new ShipBridge(mockOrchestrator as any, "/tmp");
  });

  it("US-003: maps ship:complete to reviewReady Slack message", () => {
    mockOrchestrator.emit("ship:complete", {
      runId: "run-123",
      featureId: "002-build-server",
      phaseId: "2",
    });

    expect(MessageBuilder.reviewReady).toHaveBeenCalled();
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Review Ready" }),
      expect.objectContaining({ type: "review_ready" })
    );
  });

  it("US-003: maps ship:failed to phaseFail Slack message", () => {
    mockOrchestrator.emit("ship:failed", {
      runId: "run-123",
      featureId: "002-build-server",
      phaseId: "2",
      error: "Test failure",
    });

    expect(MessageBuilder.phaseFail).toHaveBeenCalled();
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Phase Fail" }),
      expect.objectContaining({ type: "phase_fail" })
    );
  });

  it("FR-005: maps define:spec:ready to specReady Slack message (RED - Not implemented)", () => {
    // This event is not yet handled in ship-bridge.ts
    mockOrchestrator.emit("define:spec:ready", {
      featureId: "002-build-server",
      specPath: "specs/002-build-server/spec.md",
    });

    expect(MessageBuilder.specReady).toHaveBeenCalled();
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Spec Ready" }),
      expect.objectContaining({ type: "spec_ready" })
    );
  });

  it("FR-006: ensures every message has exactly one primary CTA (RED - Assertion)", () => {
    // This is a policy check. We'd need to inspect the Block Kit blocks.
    // For now, we'll assert that the MessageBuilder was called.
    mockOrchestrator.emit("ship:complete", {
      runId: "run-123",
      featureId: "002-build-server",
      phaseId: "2",
    });
    
    const call = vi.mocked(notifySlack).mock.calls[0];
    const message = call[0] as any;
    
    // Policy: All messages must have blocks with at least one button (CTA)
    expect(message.blocks).toBeDefined();
    const buttons = message.blocks.flatMap((b: any) => b.elements || []).filter((e: any) => e.type === 'button');
    expect(buttons.length).toBe(1);
  });
});
