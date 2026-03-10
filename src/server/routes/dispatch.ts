import type { FastifyInstance } from "fastify";
import type { DispatchQueue, DispatchRequest } from "../dispatch.js";

export async function dispatchRoutes(
  fastify: FastifyInstance,
  queue: DispatchQueue,
) {
  fastify.post("/api/dispatch", async (request, reply) => {
    const body = request.body as DispatchRequest;
    if (!body.featureId || !body.phaseId) {
      return reply
        .status(400)
        .send({ error: "Missing featureId or phaseId" });
    }
    const record = queue.enqueue(body);
    return reply.status(201).send(record);
  });

  fastify.get("/api/dispatch/queue", async () => {
    return queue.getQueue();
  });

  fastify.get("/api/dispatch/:feature/:phase", async (request, reply) => {
    const { feature, phase } = request.params as {
      feature: string;
      phase: string;
    };
    const record = queue.getDispatch(feature, phase);
    if (!record) {
      return reply.status(404).send({ error: "Not found" });
    }
    return record;
  });
}
