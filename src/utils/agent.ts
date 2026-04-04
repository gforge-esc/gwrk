import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { recordRoutingDecision } from "../db/plugins.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { PluginLoader } from "../plugins/loader.js";
import type { AgentBackend as ConfigAgentBackend } from "./config.js";

// ANSI — must match format.ts
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * Normalized Exit Code Map (ADR-006)
 */
export const EXIT_CODE_MAP: Record<number, number> = {
  53: 1, // Gemini turn limit
  42: 2, // Usage error
  126: 1, // Claude permission denied
  127: 127, // Command not found
};

export interface DispatchOptions {
  backend: ConfigAgentBackend | string;
  workflowPath: string;
  featureDir?: string;
  prompt?: string;
  approvalMode?: "yolo" | "auto" | "plan";
  contextPath?: string;
  workDir?: string;
  stdin?: string;
}

/** Build the command + args for a given backend. Exported for testability. */
export async function buildCommand(
  opts: DispatchOptions,
  _workflowContent: string,
): Promise<{
  command: string;
  args: string[];
  stdin?: string;
}> {
  const agentName = opts.backend as string;
  const registry = new AgentBackendRegistry(new PluginLoader());
  const adapter = await registry.getAgentBackend(agentName);

  const task: TaskDispatch = {
    prompt: opts.prompt,
    agent: agentName,
    workflow: opts.workflowPath,
    featureDir: opts.featureDir,
    stdin: opts.stdin,
  };

  const dispatch = await adapter.dispatch(task);
  return {
    command: dispatch.command,
    args: dispatch.args,
    stdin: dispatch.stdin,
  };
}

/**
 * Prefixes each output line with "HH:MM:SS +MM:SS" (wall clock + elapsed).
 * Also writes raw (un-timestamped) line to the log file.
 */
function stampLine(
  line: string,
  startEpoch: number,
  logStream?: fs.WriteStream,
): void {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
  const eMin = Math.floor(elapsed / 60);
  const eSec = elapsed % 60;
  const stamp = `${hh}:${mm}:${ss} +${String(eMin).padStart(2, "0")}:${String(eSec).padStart(2, "0")}`;

  process.stdout.write(`${DIM}${stamp}${RESET}  ${line}\n`);

  // Tee raw output to log file
  if (logStream) {
    logStream.write(`${line}\n`);
  }
}

export async function dispatchAgent(
  opts: DispatchOptions,
): Promise<{ exitCode: number; logPath: string; stdout: string; stderr: string }> {
  const projectRoot = process.cwd();
  const executionRoot = opts.workDir || projectRoot;
  const workflowFile = path.resolve(projectRoot, opts.workflowPath);
  // Guard: plugin-based workflows (e.g. "gwrk-specify") are names, not file paths.
  // workflowContent is passed to buildCommand as _workflowContent (unused).
  const workflowContent = fs.existsSync(workflowFile)
    ? fs.readFileSync(workflowFile, "utf-8")
    : "";
  const { command, args, stdin } = await buildCommand(opts, workflowContent);

  // Set up .runs/ log file
  const runsDir = path.join(projectRoot, ".runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const workflow = path.basename(opts.workflowPath, ".md");
  const rawFeature = opts.featureDir
    ? path.basename(opts.featureDir)
    : (opts.prompt ?? "unknown");
  const feature = rawFeature.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  const logPath = path.join(runsDir, `${ts}_${workflow}_${feature}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  // Write structured header to log
  const branch = process.env.GIT_BRANCH ?? "unknown";
  logStream.write("# gwrk Agent Run Log\n");
  logStream.write("# ────────────────────────────────────────\n");
  logStream.write(`# Timestamp : ${new Date().toISOString()}\n`);
  logStream.write(`# Workflow  : ${workflow}\n`);
  logStream.write(`# Feature   : ${feature}\n`);
  logStream.write(`# Backend   : ${opts.backend}\n`);
  logStream.write(`# Branch    : ${branch}\n`);
  logStream.write(`# Command   : ${command} ${args.join(" ")}\n`);
  logStream.write(`# WorkDir   : ${executionRoot}\n`);
  logStream.write("# ────────────────────────────────────────\n\n");

  return new Promise((resolve) => {
    const startEpoch = Date.now();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const child = spawn(command, args, {
      cwd: executionRoot,
      env: {
        ...process.env,
        ...(opts.contextPath ? { GWRK_CONTEXT: opts.contextPath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (stdin && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }

    // 429 squelch state machine (matches agent-run.sh)
    let squelch = false;
    let braceDepth = 0;

    const processLine = (line: string, stream: "stdout" | "stderr") => {
      // Always accumulate raw output for callers that need it (WorkflowRuntime)
      if (stream === "stdout") {
        stdoutLines.push(line);
      } else {
        stderrLines.push(line);
      }

      // Squelch 429 rate-limit error blocks
      if (!squelch && /^Attempt \d+ failed with status 429/.test(line)) {
        const attempt = line.match(/^Attempt (\d+)/)?.[1] ?? "?";
        const now = new Date();
        const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
        const stamp = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} +${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
        process.stdout.write(
          `${DIM}${stamp}${RESET}  ${YELLOW}⏳ 429 — Rate limited (attempt ${attempt}), retrying…${RESET}\n`,
        );
        logStream.write(`[429] Attempt ${attempt} — rate limited, retrying\n`);
        squelch = true;
        braceDepth = 0;
        return;
      }

      if (squelch) {
        const opens = (line.match(/{/g) || []).length;
        const closes = (line.match(/}/g) || []).length;
        braceDepth += opens - closes;
        if (braceDepth <= 0 && closes > 0) {
          squelch = false;
          braceDepth = 0;
        }
        return;
      }

      stampLine(line, startEpoch, logStream);
    };

    // Process stdout line by line
    if (child.stdout) {
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      rl.on("line", (line) => processLine(line, "stdout"));
    }

    // Process stderr line by line (same formatting)
    if (child.stderr) {
      const rlErr = readline.createInterface({
        input: child.stderr,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      rlErr.on("line", (line) => processLine(line, "stderr"));
    }

    child.on("close", (code) => {
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      logStream.write(`\n# [END] ${new Date().toISOString()}\n`);
      logStream.write(`# Duration  : ${mins}m ${secs}s\n`);
      logStream.write(`# Exit Code : ${code ?? 1}\n`);
      logStream.end();
      resolve({
        exitCode: code ?? 1,
        logPath,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      });
    });

    child.on("error", () => {
      logStream.write("\n# [ERROR] Agent process failed to start\n");
      logStream.end();
      resolve({
        exitCode: 1,
        logPath,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      });
    });
  });
}

// ─── FR-019/020/021: Plugin Dispatch Boundary (ADR-006) ──────────

/**
 * FR-019: Input contract for dispatchToAgent().
 * Maps to ADR-006 AgentBackend.dispatch() input.
 */
export interface TaskDispatch {
  type?: string;
  prompt?: string;
  agent?: ConfigAgentBackend | string;
  workDir?: string;
  stdin?: string;
  env?: Record<string, string>;
  workflow?: string;
  featureDir?: string;
}

/**
 * FR-019: Output contract for dispatchToAgent().
 * Normalized result — proprietary exit codes mapped to gwrk standard.
 */
export interface TaskResult {
  exitCode: number;
  errorType?: string;
  stdout: string;
  stderr: string;
  durationS: number;
  logPath?: string;
}

/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Internals are replaced by pluginRegistry.getAgentBackend().dispatch()
 */
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  const agentName = (task.agent ?? "gemini") as string;
  const registry = new AgentBackendRegistry(new PluginLoader());
  const adapter = await registry.getAgentBackend(agentName);

  const startTime = Date.now();
  const dispatch = await adapter.dispatch(task);

  const opts: DispatchOptions = {
    backend: agentName as ConfigAgentBackend,
    workflowPath: task.workflow ?? ".agents/workflows/gwrk-implement.md",
    featureDir: task.featureDir,
    prompt: task.prompt,
    workDir: task.workDir,
  };

  const {
    exitCode: rawExitCode,
    logPath,
    stdout,
    stderr,
  } = await dispatchAgent({
    ...opts,
    stdin: dispatch.stdin,
  });
  const durationS = Math.round((Date.now() - startTime) / 1000);

  const result = adapter.parseResult(stdout, stderr, rawExitCode);

  // Record routing decision for historical learning
  const taskType =
    task.type || path.basename(task.workflow || "unknown", ".md");
  recordRoutingDecision({
    task_type: taskType,
    selected_backend: agentName,
    outcome: result.exitCode === 0 ? "success" : "failure",
    duration_ms: durationS * 1000,
    error_message: result.errorType ?? undefined,
  });

  return {
    ...result,
    durationS,
    logPath,
  };
}
