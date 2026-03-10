export async function dispatchRoutes(fastify, queue) {
    fastify.post("/api/dispatch", async (request) => {
        const body = request.body;
        if (!body.featureId || !body.phaseId) {
            return { error: "Missing featureId or phaseId" };
        }
        const record = queue.enqueue(body);
        return record;
    });
    fastify.get("/api/dispatch/queue", async () => {
        return queue.getStatus();
    });
    fastify.get("/api/dispatch/:feature/:phase", async (request, reply) => {
        const { feature, phase } = request.params;
        const status = queue.getStatus();
        const record = [...status.active, ...status.queued, ...status.history].find((r) => r.featureId === feature && r.phaseId === phase);
        if (!record) {
            reply.code(404).send({ error: "Dispatch record not found" });
            return;
        }
        return record;
    });
}
