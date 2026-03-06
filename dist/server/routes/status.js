export async function statusRoutes(fastify, monitor, queue) {
    fastify.get("/api/status", async () => {
        const stats = monitor.sample();
        return {
            server: {
                status: "running",
                pid: process.pid,
            },
            system: {
                cpuPercent: stats.cpuPercent,
                memPercent: stats.memPercent,
                diskFreeGb: stats.diskFreeGb,
            },
            dispatch: {
                queueDepth: queue.getQueueDepth(),
            },
            sandboxes: queue.getActiveCount(),
        };
    });
}
