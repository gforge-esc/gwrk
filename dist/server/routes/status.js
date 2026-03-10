const startTime = Date.now();
export async function statusRoutes(fastify, monitor, queue, sandbox) {
    fastify.get("/api/status", async () => {
        const stats = monitor.getResources();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const sandboxes = await sandbox.listSandboxes();
        // We assume server is running since this route is handling requests
        const port = fastify.server.address()?.port;
        return {
            server: {
                status: "running",
                pid: process.pid,
                uptime,
                port,
            },
            system: {
                cpuPercent: stats.cpuPercent,
                memPercent: stats.memPercent,
                diskFreeGb: stats.diskFreeGb,
            },
            dispatch: {
                queueDepth: queue.getQueueDepth(),
                activeCount: queue.getActiveCount(),
                completedCount: queue.getCompletedCount(),
                failedCount: queue.getFailedCount(),
            },
            sandboxes: sandboxes,
        };
    });
}
