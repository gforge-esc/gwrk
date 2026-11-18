/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "node:events";
import type { ActionsBlock, HeaderBlock, SectionBlock } from "@slack/types";
import { describe, expect, it, vi } from "vitest";
import type { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import { ShipBridge } from "./ship-bridge.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type { AgentBackend, DispatchStatus } from "./types.js";

vi.mock("./slack-notify.js", () => ({ notifySlack: vi.fn() }));

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

  it("shows and serializes the orchestrator's pull request on the review card", () => {
    const prNumber = 101;
    const prUrl = "https://github.com/org/alpha/pull/101";
    const orchestrator = Object.assign(new EventEmitter(), {
      getResult: () => ({ prNumber, prUrl }),
    });
    new ShipBridge(orchestrator as unknown as ShipOrchestrator, process.cwd());
    const event = {
      runId: mockDispatch.id,
      featureId: mockDispatch.featureId,
      phaseId: mockDispatch.phaseId,
      backend: mockDispatch.backend,
    };
    orchestrator.emit("ship:start", event);
    orchestrator.emit("ship:complete", event);

    const [message] = vi.mocked(notifySlack).mock.lastCall!;
    expect.soft(message.blocks).toContainEqual({
      type: "section",
      text: { type: "mrkdwn", text: `*Pull Request:* <${prUrl}|#${prNumber}>` },
    });
    const actions = message.blocks.find(
      (block): block is ActionsBlock => block.type === "actions",
    );
    const merge = actions?.elements.find(
      (element) =>
        element.type === "button" && element.action_id === "merge_pr",
    );
    if (merge?.type !== "button" || !merge.value) {
      throw new Error("Expected a merge button");
    }
    expect(JSON.parse(merge.value)).toMatchObject({
      featureId: event.featureId,
      phaseId: event.phaseId,
      prNumber,
    });
  });

  const routing = {
    projectId: "project-a",
    projectSlug: "alpha",
    rootTs: "3.1",
  };
  const dispatch = { ...mockDispatch, ...routing };
  it.each([
    [
      "reviewReady",
      MessageBuilder.reviewReady(dispatch),
      3,
      { phaseId: dispatch.phaseId },
    ],
    [
      "phaseFail",
      MessageBuilder.phaseFail(dispatch),
      2,
      { phaseId: dispatch.phaseId },
    ],
    [
      "specReady",
      MessageBuilder.specReady(dispatch.featureId, "spec.md", routing),
      2,
      { specPath: "spec.md" },
    ],
    [
      "planReady",
      MessageBuilder.planReady(dispatch.featureId, "plan.md", 1, routing),
      2,
      { planPath: "plan.md" },
    ],
  ] as const)(
    "%s shows the project and stamps its buttons",
    (_name, message, count, details) => {
      expect(message.blocks).toContainEqual({
        type: "context",
        elements: [{ type: "mrkdwn", text: "*Project:* `alpha`" }],
      });
      const actions = message.blocks.find(
        (block): block is ActionsBlock => block.type === "actions",
      );
      expect(actions?.elements).toHaveLength(count);
      for (const button of actions?.elements ?? []) {
        if (button.type !== "button" || !button.value) {
          throw new Error("Expected an interactive button");
        }
        expect(JSON.parse(button.value)).toMatchObject({
          ...routing,
          ...details,
          featureId: dispatch.featureId,
        });
      }
    },
  );

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

  it("should build specReady message with buttons (FR-016)", () => {
    const msg = MessageBuilder.specReady(
      "003-slack",
      "specs/003-slack/spec.md",
    );
    expect(msg.text).toContain("Spec Ready");
    expect(msg.text).toContain("003-slack");
    const actions = msg.blocks.find(
      (b) => b.type === "actions",
    ) as ActionsBlock;
    expect(actions.elements).toHaveLength(2);

    const approveBtn = actions.elements[0] as any;
    expect(approveBtn.action_id).toBe("approve_spec");
    const approveValue = JSON.parse(approveBtn.value);
    expect(approveValue.featureId).toBe("003-slack");
    expect(approveValue.specPath).toBe("specs/003-slack/spec.md");

    const reviseBtn = actions.elements[1] as any;
    expect(reviseBtn.action_id).toBe("revise_spec");
  });

  it("should build planReady message with buttons (FR-016)", () => {
    const msg = MessageBuilder.planReady(
      "003-slack",
      "specs/003-slack/plan.md",
      5,
    );
    expect(msg.text).toContain("Plan Ready");
    expect(msg.text).toContain("003-slack");
    expect(msg.text).toContain("5 phases");
    const actions = msg.blocks.find(
      (b) => b.type === "actions",
    ) as ActionsBlock;
    expect(actions.elements).toHaveLength(2);

    const approveBtn = actions.elements[0] as any;
    expect(approveBtn.action_id).toBe("approve_plan");
    const approveValue = JSON.parse(approveBtn.value);
    expect(approveValue.featureId).toBe("003-slack");
    expect(approveValue.planPath).toBe("specs/003-slack/plan.md");

    const reviseBtn = actions.elements[1] as any;
    expect(reviseBtn.action_id).toBe("revise_plan");
  });

  it("should build pulseSummary message (TR-005)", () => {
    const report = {
      generatedAt: new Date().toISOString(),
      repositories: [
        {
          repoName: "gwrk",
          mainLoc: 1000,
          draftLoc: 200,
          weeklyBuckets: [1, 2, 3],
        },
      ],
    };
    const msg = MessageBuilder.pulseSummary(report as any);
    expect(msg.text).toContain("Pulse Daily Summary");
    expect(JSON.stringify(msg.blocks)).toContain("gwrk");
    expect(JSON.stringify(msg.blocks)).toContain("1000");
  });

  it("should build doneDone message (TR-005)", () => {
    const report = {
      compression: {
        pointCompression: 2.5,
        totalCompression: 3.1,
      },
      actuals: {
        activeCodingMinutes: 120,
        deliveryWindowHours: 48,
        dormancyDays: 1,
      },
    };
    const msg = MessageBuilder.doneDone("003-slack", report as any);
    expect(msg.text).toContain("Done Done");
    expect(msg.text).toContain("003-slack");
    expect(JSON.stringify(msg.blocks)).toContain("2.5x");
    expect(JSON.stringify(msg.blocks)).toContain("2.0h"); // 120 min = 2h
  });
});
