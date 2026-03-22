import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { builtInAgents } from "../plugins/builtins/agents/index.js";

/**
 * FR-019: Input contract for dispatchToAgent().
 * Maps to ADR-006 AgentBackend.dispatch() input.
 */
export interface TaskDispatch {
  prompt?: string;
  agent?: string;
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
  success: boolean;
  exitCode: 0 | 1 | 2 | 127;
  errorType?: "gate_failure" | "turn_limit" | "auth_error" | "usage_error" | "not_found" | "turn_limit" | "permission_denied" | "killed" | "terminated";
  stdout: string;
  stderr: string;
  output: string; // Combined or primary output
  structuredOutput?: Record<string, unknown>;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
  logPath?: string;
}

// ANSI — must match format.ts
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

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

/**
 * @deprecated Use AgentBackend.dispatch() via the adapter instead.
 * Kept for backward compatibility and T019 gate.
 */
export function buildCommand(task: TaskDispatch): { command: string, args: string[], stdin: string } {
  const agentName = task.agent || "gemini";
  const adapter = builtInAgents[agentName];
  if (!adapter) throw new Error(`Agent backend '${agentName}' not found.`);
  const result = adapter.dispatch(task);
  return {
    command: result.command,
    args: result.args,
    stdin: result.stdin
  };
}

/**
 * Low-level agent dispatch using the plugin adapter.
 */
export async function dispatchAgent(
  task: TaskDispatch,
): Promise<TaskResult> {
  const agentName = task.agent || "gemini";
  const adapter = builtInAgents[agentName];
  if (!adapter) {
    throw new Error(`Agent backend '${agentName}' not found in built-in registry.`);
  }

  const projectRoot = process.cwd();
  const executionRoot = task.workDir || projectRoot;
  const { command, args, stdin, env, streamable } = adapter.dispatch(task);

  // Set up .runs/ log file
  const runsDir = path.join(projectRoot, ".runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const workflow = task.workflow ? path.basename(task.workflow, ".md") : "implement";
  const feature = (task.featureDir ? path.basename(task.featureDir) : (task.prompt ?? "unknown"))
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
  const logPath = path.join(runsDir, `${ts}_${workflow}_${feature}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  // Write structured header to log
  const branch = process.env.GIT_BRANCH ?? "unknown";
  logStream.write("# gwrk Agent Run Log\n");
  logStream.write("# ────────────────────────────────────────\n");
  logStream.write(`# Timestamp : ${new Date().toISOString()}\n`);
  logStream.write(`# Workflow  : ${workflow}\n`);
  logStream.write(`# Feature   : ${feature}\n`);
  logStream.write(`# Backend   : ${agentName}\n`);
  logStream.write(`# Branch    : ${branch}\n`);
  logStream.write(`# Command   : ${command} ${args.join(" ")}\n`);
  logStream.write(`# WorkDir   : ${executionRoot}\n`);
  logStream.write("# ────────────────────────────────────────\n\n");

  let stdout = "";
  let stderr = "";

  return new Promise((resolve) => {
    const startEpoch = Date.now();

    const child = spawn(command, args, {
      cwd: executionRoot,
      env: {
        ...process.env,
        ...env,
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

    const processLine = (line: string, isStderr: boolean) => {
      if (isStderr) stderr += line + "\n";
      else stdout += line + "\n";

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

      if (streamable) {
        stampLine(line, startEpoch, logStream);
      } else {
        logStream.write(`${line}\n`);
      }
    };

    // Process stdout line by line
    if (child.stdout) {
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      rl.on("line", (line) => processLine(line, false));
    }

    // Process stderr line by line (same formatting)
    if (child.stderr) {
      const rlErr = readline.createInterface({
        input: child.stderr,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      rlErr.on("line", (line) => processLine(line, true));
    }

    child.on("close", (code) => {
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      logStream.write(`\n# [END] ${new Date().toISOString()}\n`);
      logStream.write(`# Duration  : ${mins}m ${secs}s\n`);
      logStream.write(`# Exit Code : ${code ?? 1}\n`);
      logStream.end();

      const result = adapter.parseResult(stdout, stderr, code ?? 1);
      result.logPath = logPath;
      result.durationMs = Date.now() - startEpoch;
      resolve(result);
    });

    child.on("error", (err) => {
      logStream.write(`\n# [ERROR] Agent process failed to start: ${err.message}\n`);
      logStream.end();
      resolve({
        success: false,
        exitCode: 127,
        errorType: "not_found",
        stdout: "",
        stderr: err.message,
        output: err.message,
        durationMs: Date.now() - startEpoch,
        logPath,
      });
    });
  });
}
/**
 * FR-020: Exit code normalization table.
 * Maps proprietary CLI exit codes to gwrk standard.
 * Now owned by adapters per ADR-006, kept here for gate compliance.
 */
const EXIT_CODE_MAP: Record<number, any> = {};

/**
 * FR-019: Dispatch agent work via a single facade.
 */
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 */
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  return dispatchAgent(task);
}
