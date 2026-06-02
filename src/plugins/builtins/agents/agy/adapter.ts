export type AgentBackend = any;
export type TaskDispatch = any;
export type TaskResult = any;

export class AgyAdapter implements AgentBackend {
  name = "agy";
  dispatchMode = "local-cli";
  contextFileName = "AGENTS.md";

  async syncGovernance(projectRoot: string, governance: string): Promise<string> {
    throw new Error("Not implemented");
  }

  async dispatch(task: TaskDispatch): Promise<{
    command: string;
    args: string[];
    stdin: string;
    env?: Record<string, string>;
    streamable: boolean;
  }> {
    throw new Error("Not implemented");
  }

  async isAvailable(): Promise<boolean> {
    throw new Error("Not implemented");
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    throw new Error("Not implemented");
  }
}
