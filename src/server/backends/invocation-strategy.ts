import { type TaskResult, dispatchToAgent } from "../../utils/agent.js";
import type { AgentBackend } from "../../utils/config.js";

export interface TaskInvocation {
  taskId: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
  workDir: string;
  prompt?: string;
}

export interface InvocationStrategy {
  invoke(task: TaskInvocation): Promise<TaskResult>;
}

export class LocalInvocationStrategy implements InvocationStrategy {
  async invoke(task: TaskInvocation): Promise<TaskResult> {
    return dispatchToAgent({
      agent: task.backend,
      workDir: task.workDir,
      featureDir: `specs/${task.featureId}`,
      prompt: task.prompt || `Task ${task.taskId} in phase ${task.phaseId}`,
      workflow: ".agents/workflows/gwrk-implement.md",
    });
  }
}
