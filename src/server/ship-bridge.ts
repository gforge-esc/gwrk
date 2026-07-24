/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import { getCurrentBranch } from "../utils/git.js";
import { MessageBuilder } from "./slack-messages.js";
import { notifySlack } from "./slack-notify.js";
import type { DispatchRecord } from "./types.js";

/**
 * ShipBridge connects ShipOrchestrator events to Slack notifications.
 * This allows the orchestrator to remain agnostic of the notification
 * system while still providing rich updates to Slack.
 */
export class ShipBridge {
  private record: DispatchRecord;

  constructor(orchestrator: ShipOrchestrator, cwd: string) {
    const startedAt = new Date().toISOString();

    // Initialize with partial data, will be fully populated on ship:start
    this.record = {
      id: "pending",
      featureId: "unknown",
      phaseId: "unknown",
      backend: "agy" as any,
      status: "running",
      branchName: getCurrentBranch(cwd),
      attempts: [],
      tasks: [],
      createdAt: startedAt,
    };

    orchestrator.on("ship:start", (event) => {
      this.record.id = event.runId;
      this.record.featureId = event.featureId;
      this.record.phaseId = event.phaseId;
      this.record.backend = event.backend;
      this.record.attempts = [
        {
          attemptNumber: 1,
          backend: event.backend,
          startedAt: new Date().toISOString(),
        },
      ];

      // Foxtrot Charlie: No phaseStart notification.
      // The PE started the ship — they know. Only messages
      // with a bless CTA should reach Slack.
    });

    orchestrator.on("ship:failed", (event) => {
      this.record.status = "failed";
      notifySlack(MessageBuilder.phaseFail(this.record, event.error), {
        type: "phase_fail",
        feature: event.featureId,
        phase: event.phaseId,
        payload: { ...this.record, error: event.error } as any,
        timestamp: new Date().toISOString(),
      });
    });

    orchestrator.on("ship:complete", (event) => {
      this.record.status = "completed";
      this.record.completedAt = new Date().toISOString();

      // Notify that it's ready for review (with blessing actions)
      // The phase_complete message is redundant if review_ready is sent
      notifySlack(MessageBuilder.reviewReady(this.record), {
        type: "review_ready",
        feature: event.featureId,
        phase: event.phaseId,
        payload: this.record as any,
        timestamp: new Date().toISOString(),
      });
    });

    orchestrator.on("ship:blocked", (event) => {
      this.record.status = "failed"; // Blocked is a terminal failure state
      notifySlack(
        MessageBuilder.phaseFail(
          this.record,
          `BLOCKED: ${event.reason}. Escalate to Principal Engineer.`,
        ),
        {
          type: "phase_fail",
          feature: event.featureId,
          phase: event.phaseId,
          payload: { ...this.record, error: event.reason } as any,
          timestamp: new Date().toISOString(),
        },
      );
    });

    orchestrator.on("define:spec:ready", (event) => {
      notifySlack(MessageBuilder.specReady(event.featureId, event.specPath), {
        type: "spec_ready",
        feature: event.featureId,
        payload: event as any,
        timestamp: new Date().toISOString(),
      });
    });

    orchestrator.on("define:plan:ready", (event) => {
      notifySlack(
        MessageBuilder.planReady(
          event.featureId,
          event.planPath,
          event.phaseCount,
        ),
        {
          type: "plan_ready",
          feature: event.featureId,
          payload: event as any,
          timestamp: new Date().toISOString(),
        },
      );
    });
  }
}
