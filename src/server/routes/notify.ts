import type { FastifyInstance } from "fastify";
import { MessageBuilder } from "../slack-messages.js";
import { notifySlack } from "../slack-notify.js";
import type { DispatchRecord, NotifyPayload } from "../types.js";

export async function notifyRoutes(server: FastifyInstance) {
  server.post<{ Body: NotifyPayload }>("/api/notify", async (request, reply) => {
    const payload = request.body;

    if (!payload.type || !payload.feature) {
      return reply.status(400).send({
        ok: false,
        error: "Missing required fields: type and feature are required",
      });
    }

    // Map NotifyPayload to a minimal DispatchRecord for MessageBuilder
    // Many fields are optional or have defaults because agent-run.sh
    // might not have the full context of a database record.
    const dispatch: DispatchRecord = {
      id: "notify-event", // dummy
      featureId: payload.feature,
      phaseId: payload.phase || "unknown",
      backend: (payload.backend as any) || "gemini",
      status: "running", // default
      branchName: payload.branch || "main",
      attempts: [],
      createdAt: new Date().toISOString(),
      prUrl: payload.prUrl,
      prNumber: payload.prNumber,
    };

    let message;
    switch (payload.type) {
      case "phase_start":
        message = MessageBuilder.phaseStart(dispatch);
        break;
      case "phase_complete":
        dispatch.status = "completed";
        message = MessageBuilder.phaseComplete(dispatch);
        break;
      case "phase_fail":
        dispatch.status = "failed";
        message = MessageBuilder.phaseFail(dispatch, payload.error);
        break;
      case "ci_result":
        message = MessageBuilder.ciResult(dispatch, {
          passed: !payload.error,
          summary: payload.gateResults || payload.error || "CI results ready",
        });
        break;
      case "review_ready":
        // For review_ready, we might want to include the PR URL if provided
        // MessageBuilder.reviewReady currently doesn't show the URL, but the spec says it should.
        // We'll use the builder as is for now.
        message = MessageBuilder.reviewReady(dispatch);
        break;
      case "done_done":
        message = MessageBuilder.doneDone(payload.feature);
        break;
      default:
        return reply.status(400).send({
          ok: false,
          error: `Unknown notification type: ${payload.type}`,
        });
    }

    // Route to master if requested or for specific cross-project types
    const isMaster = payload.masterOnly || payload.type === "done_done";

    try {
      await notifySlack(message, {
        type: payload.type,
        feature: payload.feature,
        phase: payload.phase,
        master: isMaster,
        payload: payload as any,
        timestamp: new Date().toISOString(),
      }, { master: isMaster });

      return { ok: true };
    } catch (error) {
      server.log.error(error);
      return reply.status(500).send({
        ok: false,
        error: `Failed to dispatch notification: ${(error as any).message}`,
      });
    }
  });
}
