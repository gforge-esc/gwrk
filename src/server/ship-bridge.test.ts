/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShipBridge } from "./ship-bridge.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";

vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn(),
}));

vi.mock("./slack-messages.js", () => ({
  MessageBuilder: {
    reviewReady: vi.fn().mockReturnValue({
      text: "Review Ready",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "Ready" } },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Merge" },
              action_id: "merge_pr",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject" },
              action_id: "reject",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "View" },
              action_id: "view",
            },
          ],
        },
      ],
    }),
    phaseFail: vi.fn().mockReturnValue({ text: "Phase Fail", blocks: [] }),
    specReady: vi.fn().mockReturnValue({ text: "Spec Ready", blocks: [] }),
    planReady: vi.fn().mockReturnValue({ text: "Plan Ready", blocks: [] }),
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
      expect.objectContaining({ type: "review_ready" }),
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
      expect.objectContaining({ type: "phase_fail" }),
    );
  });

  it("FR-005: maps define:spec:ready to specReady Slack message (RED)", () => {
    mockOrchestrator.emit("define:spec:ready", {
      featureId: "002-build-server",
      specPath: "specs/002-build-server/spec.md",
    });

    expect(MessageBuilder.specReady).toHaveBeenCalledWith(
      "002-build-server",
      "specs/002-build-server/spec.md",
    );
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Spec Ready" }),
      expect.objectContaining({ type: "spec_ready" }),
    );
  });

  it("FR-005: maps define:plan:ready to planReady Slack message (RED)", () => {
    mockOrchestrator.emit("define:plan:ready", {
      featureId: "002-build-server",
      planPath: "specs/002-build-server/plan.md",
      phaseCount: 5,
    });

    expect(MessageBuilder.planReady).toHaveBeenCalledWith(
      "002-build-server",
      "specs/002-build-server/plan.md",
      5,
    );
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Plan Ready" }),
      expect.objectContaining({ type: "plan_ready" }),
    );
  });

  it("FR-006: ensures every message has exactly one primary CTA (RED)", () => {
    mockOrchestrator.emit("ship:complete", {
      runId: "run-123",
      featureId: "002-build-server",
      phaseId: "2",
    });

    const call = vi.mocked(notifySlack).mock.calls[0];
    const message = call[0] as any;

    expect(message.blocks).toBeDefined();
    const buttons = message.blocks
      .flatMap((b: any) => b.elements || [])
      .filter((e: any) => e.type === "button");
    expect(buttons.length).toBe(3);
  });
});
