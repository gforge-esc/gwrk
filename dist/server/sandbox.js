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
        const { featureId, phaseId, backend, projectRoot, image = "gwrk-sandbox:bookworm-slim" } = opts;
        const container = await this.docker.createContainer({
            Image: image,
            Labels: {
                "gwrk.feature": featureId,
                "gwrk.phase": phaseId,
                "gwrk.backend": backend,
                "gwrk.startedAt": new Date().toISOString(),
            },
            HostConfig: {
                Binds: [
                    `${projectRoot}:/workspace`
                ],
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
        const containers = await this.docker.listContainers({
            all: true,
            filters: {
                label: ["gwrk.feature"],
            },
        });
        return containers.map(c => ({
            containerId: c.Id,
            featureId: c.Labels["gwrk.feature"],
            phaseId: c.Labels["gwrk.phase"],
            backend: c.Labels["gwrk.backend"],
            status: this.mapStateToStatus(c.State),
            startedAt: c.Labels["gwrk.startedAt"],
        }));
    }
    mapStateToStatus(state) {
        switch (state) {
            case "created":
                return "creating";
            case "running":
                return "running";
            case "exited":
            case "stopped":
                return "destroyed";
            default:
                return "stopping";
        }
    }
}
