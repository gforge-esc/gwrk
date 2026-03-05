import fs from "node:fs";
import path from "node:path";
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
  let stdin: string | undefined;

  const projectRoot = process.cwd();
  const workflowFile = path.resolve(projectRoot, opts.workflowPath);
  const workflowContent = fs.readFileSync(workflowFile, "utf-8");

  switch (opts.backend) {
    case "gemini":
      command = "gemini";
      // Pass workflow via stdin, or --prompt flag?
      // T009 says 'pass workflow content via stdin or avoid positional/flag conflict'
      // If we use stdin, we don't pass -p <file>.
      stdin = workflowContent;
      break;
    case "claude":
      command = "claude";
      args.push("--output-format", "json");
      stdin = workflowContent;
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

  return execCommand(command, args, stdin);
}
