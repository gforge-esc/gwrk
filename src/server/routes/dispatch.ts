/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance } from "fastify";
import {
  DispatchIntakeError,
  type DispatchQueue,
  type DispatchRequest,
} from "../dispatch.js";

export async function dispatchRoutes(
  fastify: FastifyInstance,
  queue: DispatchQueue,
) {
  fastify.post("/api/dispatch", async (request, reply) => {
    const body = (request.body ?? {}) as DispatchRequest;
    if (!body.featureId || !body.phaseId) {
      return reply.status(400).send({ error: "Missing featureId or phaseId" });
    }
    try {
      const receipt =
        typeof queue.accept === "function"
          ? queue.accept(body, { defaultRecipientSurface: "http" })
          : null;
      if (receipt) {
        return reply.status(receipt.deduplicated ? 200 : 201).send(receipt);
      }
      const record = queue.enqueue(body);
      return reply.status(201).send(record);
    } catch (error) {
      if (error instanceof DispatchIntakeError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.get("/api/dispatch/queue", async () => {
    return queue.getQueue();
  });

  fastify.get("/api/dispatch/:feature/:phase", async (request, reply) => {
    const { feature, phase } = request.params as {
      feature: string;
      phase: string;
    };
    const { projectId } = (request.query ?? {}) as { projectId?: string };
    if (projectId !== undefined) {
      const operation =
        typeof queue.getOperation === "function"
          ? queue.getOperation(projectId, feature, phase)
          : null;
      if (!operation) {
        return reply.status(404).send({ error: "Not found" });
      }
      return operation;
    }
    const record = queue.getDispatch(feature, phase);
    if (!record) {
      return reply.status(404).send({ error: "Not found" });
    }
    return record;
  });
}
