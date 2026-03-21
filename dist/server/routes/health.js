import { isSlackConnected } from "../slack.js";
export async function healthRoutes(server, lifecycle, network, sandbox) {
    server.get("/health", async () => {
        const gitOk = await sandbox.checkGit();
        const networkOk = network.isOnline();
        const slackOk = await isSlackConnected();
        const lifecycleStatus = lifecycle.getStatus();
        const components = {
            server: {
                status: lifecycleStatus === "degraded" ? "degraded" : "ok",
            },
            git: {
                status: gitOk ? "ok" : "unavailable",
            },
            network: {
                status: networkOk ? "ok" : "unavailable",
            },
            slack: {
                status: slackOk ? "ok" : "unavailable",
            },
        };
        const overallStatus = components.server.status === "ok" &&
            components.git.status === "ok" &&
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
