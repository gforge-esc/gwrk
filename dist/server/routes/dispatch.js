export async function dispatchRoutes(fastify, queue) {
    fastify.post("/api/dispatch", async (request, reply) => {
        const body = request.body;
        if (!body.featureId || !body.phaseId) {
            return reply.status(400).send({ error: "Missing featureId or phaseId" });
        }
        const record = queue.enqueue(body);
        return reply.status(201).send(record);
    });
    fastify.get("/api/dispatch/queue", async () => {
        return queue.getQueue();
    });
    fastify.get("/api/dispatch/:feature/:phase", async (request, reply) => {
        const { feature, phase } = request.params;
        const record = queue.getDispatch(feature, phase);
        if (!record) {
            return reply.status(404).send({ error: "Not found" });
        }
        return record;
    });
}
