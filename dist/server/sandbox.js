import Docker from "dockerode";
export class SandboxManager {
    docker;
    constructor() {
        this.docker = new Docker();
    }
    async checkDocker() {
        try {
            await this.docker.ping();
            return true;
        }
        catch {
            return false;
        }
    }
    async createSandbox(opts) {
        const { featureId, phaseId, backend, projectRoot, image = "gwrk-sandbox:bookworm-slim", } = opts;
        const container = await this.docker.createContainer({
            Image: image,
            Labels: {
                "gwrk.feature": featureId,
                "gwrk.phase": phaseId,
                "gwrk.backend": backend,
                "gwrk.startedAt": new Date().toISOString(),
            },
            HostConfig: {
                Binds: [`${projectRoot}:/workspace`],
            },
            Tty: true,
            // We might want to keep it running for the agent to execute commands
            Cmd: ["/bin/bash"],
        });
        await container.start();
        return container.id;
    }
    async destroySandbox(containerId) {
        const container = this.docker.getContainer(containerId);
        try {
            await container.stop();
        }
        catch {
            // Container might already be stopped
        }
        try {
            await container.remove();
        }
        catch {
            // Container might already be removed
        }
    }
    async listSandboxes() {
        const containers = (await this.docker.listContainers({
            all: true,
            filters: {
                label: ["gwrk.feature"],
            },
        })) || [];
        return containers.map((c) => ({
            containerId: c.Id,
            featureId: c.Labels["gwrk.feature"],
            phaseId: c.Labels["gwrk.phase"],
            backend: c.Labels["gwrk.backend"],
            status: this.mapStateToStatus(c.State),
            startedAt: c.Labels["gwrk.startedAt"],
        }));
    }
    async pauseAll() {
        const sandboxes = await this.listSandboxes();
        for (const sandbox of sandboxes) {
            if (sandbox.status === "running") {
                const container = this.docker.getContainer(sandbox.containerId);
                try {
                    await container.pause();
                }
                catch (e) {
                    console.error(`Failed to pause container ${sandbox.containerId}:`, e);
                }
            }
        }
    }
    async unpauseAll() {
        const sandboxes = await this.listSandboxes();
        for (const sandbox of sandboxes) {
            // In Dockerode, a paused container has status 'paused' but SandboxInfo might map it to something else
            // Let's check raw state if needed or just try to unpause everything that's not destroyed
            const container = this.docker.getContainer(sandbox.containerId);
            try {
                // We can check the state from listContainers directly if we want to be surgical
                await container.unpause();
            }
            catch (e) {
                // Might not be paused
            }
        }
    }
    mapStateToStatus(state) {
        switch (state) {
            case "created":
                return "creating";
            case "running":
            case "paused":
                return "running";
            case "exited":
            case "stopped":
                return "destroyed";
            default:
                return "stopping";
        }
    }
}
