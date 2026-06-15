import { type TaskResult, dispatchToAgent } from "../../utils/agent.js";
import type { AgentBackendId } from "../../utils/config.js";

interface TaskInvocation {
  taskId: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackendId;
  model?: string;
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
      model: task.model,
      workDir: task.workDir,
      featureDir: `specs/${task.featureId}`,
      prompt: task.prompt || `Task ${task.taskId} in phase ${task.phaseId}`,
      workflow: "gwrk-implement",
    });
  }
}
