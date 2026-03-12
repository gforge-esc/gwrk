const startTime = Date.now();
export async function getStatusData(monitor, queue, sandbox, lifecycle, network, fastify) {
    const stats = monitor.getResources();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const sandboxes = await sandbox.listSandboxes();
    let port;
    if (fastify) {
        const address = fastify.server.address();
        port = address && typeof address === "object" ? address.port : undefined;
    }
    return {
        server: {
            status: "running",
            lifecycle: lifecycle.getStatus(),
            pid: process.pid,
            uptime,
            port,
        },
        system: {
            cpuPercent: stats.cpuPercent,
            memPercent: stats.memPercent,
            diskFreeGb: stats.diskFreeGb,
        },
        network: {
            status: network.getStatus(),
        },
        dispatch: {
            queueDepth: queue.getQueueDepth(),
            activeCount: queue.getActiveCount(),
            completedCount: queue.getCompletedCount(),
            failedCount: queue.getFailedCount(),
            paused: queue.getQueue().paused,
        },
        sandboxes: sandboxes,
    };
}
export async function statusRoutes(fastify, monitor, queue, sandbox, lifecycle, network) {
    fastify.get("/api/status", async () => {
        return getStatusData(monitor, queue, sandbox, lifecycle, network, fastify);
    });
}
