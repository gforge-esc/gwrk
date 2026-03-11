import { isSlackConnected } from "../slack.js";
export async function healthRoutes(server, lifecycle, network, sandbox) {
    server.get("/health", async () => {
        const dockerOk = await sandbox.checkDocker();
        const networkOk = network.isOnline();
        const slackOk = await isSlackConnected();
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
            slack: {
                status: slackOk ? "ok" : "unavailable",
            },
        };
        const overallStatus = components.server.status === "ok" &&
            components.docker.status === "ok" &&
            components.network.status === "ok" &&
            components.slack.status === "ok"
            ? "ok"
            : "degraded";
        return {
            status: overallStatus,
            components,
        };
    });
}
