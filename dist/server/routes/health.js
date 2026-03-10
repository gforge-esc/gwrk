export async function healthRoutes(server, lifecycle, network, sandbox) {
    server.get("/health", async () => {
        const dockerOk = await sandbox.checkDocker();
        const networkOk = network.isOnline();
        const lifecycleStatus = lifecycle.getStatus();
        const components = {
            server: {
                status: lifecycleStatus === "degraded" ? "degraded" : "ok",
            },
            docker: {
                status: dockerOk ? "ok" : "unavailable",
            },
            network: {
                status: networkOk ? "ok" : "unavailable",
            },
        };
        const overallStatus = components.server.status === "ok" &&
            components.docker.status === "ok" &&
            components.network.status === "ok"
            ? "ok"
            : "degraded";
        return {
            status: overallStatus,
            components,
        };
    });
}
