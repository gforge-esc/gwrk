import type { AgentBackend } from "./config.js";
import { type ExecResult, execCommand } from "./exec.js";

export interface DispatchOptions {
  backend: AgentBackend;
  workflowPath: string;
  featureDir?: string;
  prompt?: string;
  approvalMode?: "yolo" | "auto" | "plan";
}

export async function dispatchAgent(
  opts: DispatchOptions,
): Promise<ExecResult> {
  const args: string[] = [];
  let command = "";

  switch (opts.backend) {
    case "gemini":
      command = "gemini";
      args.push("-p", opts.workflowPath);
      break;
    case "claude":
      command = "claude";
      args.push("-p", "--output-format", "json", opts.workflowPath);
      break;
    case "codex":
      command = "codex";
      args.push("exec", "--full-auto", opts.workflowPath);
      break;
    case "codex-cloud":
      command = "codex";
      args.push(
        "run",
        "--cloud",
        "--non-interactive",
        "--full-auto",
        opts.workflowPath,
      );
      break;
  }

  if (opts.featureDir) {
    args.push(opts.featureDir);
  }

  if (opts.prompt) {
    args.push(opts.prompt);
  }

  if (opts.backend === "gemini" && opts.approvalMode) {
    args.push(`--approve-mode=${opts.approvalMode}`);
  }

  return execCommand(command, args);
}
