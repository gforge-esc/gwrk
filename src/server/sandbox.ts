import Docker from "dockerode";

export interface SandboxOptions {
  featureId: string;
  phaseId: string;
  projectRoot: string;
  image?: string;
}

export class SandboxManager {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async checkDocker(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async createSandbox(opts: SandboxOptions): Promise<string> {
    const { featureId, phaseId, projectRoot, image = "gwrk-sandbox:bookworm-slim" } = opts;
    
    const container = await this.docker.createContainer({
      Image: image,
      Labels: {
        "gwrk.feature": featureId,
        "gwrk.phase": phaseId,
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

  async destroySandbox(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop();
    } catch {
      // Container might already be stopped
    }
    try {
      await container.remove();
    } catch {
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
      status: c.State,
    }));
  }
}
