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
        return queue.getQueue();
    });
    fastify.get("/api/dispatch/:feature/:phase", async (request) => {
        const { feature, phase } = request.params;
        const record = queue.getDispatch(feature, phase);
        if (!record) {
            return { error: "Not found" };
        }
        return record;
    });
}
