import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { AgentBackend } from "./config.js";

// ANSI — must match format.ts
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export interface DispatchOptions {
  backend: AgentBackend;
  workflowPath: string;
  featureDir?: string;
  prompt?: string;
  approvalMode?: "yolo" | "auto" | "plan";
  contextPath?: string;
  workDir?: string;
}

/** Build the command + args for a given backend. Exported for testability. */
export function buildCommand(
  opts: DispatchOptions,
  _workflowContent: string,
): {
  command: string;
  args: string[];
  stdin?: string;
} {
  const args: string[] = [];
  let command = "";
  let stdin: string | undefined;

  // Extract slash command name from workflow path: .agents/workflows/gwrk-plan.md → /plan
  const workflowName = path.basename(opts.workflowPath, ".md");

  switch (opts.backend) {
    case "gemini": {
      command = "gemini";
      // Build the slash command string matching agent-run.sh:
      //   gemini -p "/plan specs/001-cli-core" --approval-mode yolo
      let slashCmd = `/${workflowName}`;
      if (opts.featureDir) slashCmd += ` ${opts.featureDir}`;
      if (opts.prompt) slashCmd += ` ${opts.prompt}`;
      args.push("-p", slashCmd);

      // Approval mode: analyze is read-only (plan mode), everything else is yolo
      const mode =
        opts.approvalMode ?? (workflowName.endsWith("analyze") ? "plan" : "yolo");
      args.push("--approval-mode", mode);

      if (opts.contextPath) {
        // Pass context via env var — gemini CLI doesn't support -c
        // The workflow template can read GWRK_CONTEXT
      }
      break;
    }
    case "claude":
      command = "claude";
      args.push("-p", _workflowContent, "--output-format", "json");
      if (opts.featureDir) args.push(opts.featureDir);
      if (opts.prompt) args.push(opts.prompt);
      if (opts.contextPath) args.push("--context", opts.contextPath);
      break;
    case "codex":
      command = "codex";
      args.push("exec", "--full-auto", opts.workflowPath);
      if (opts.featureDir) args.push(opts.featureDir);
      if (opts.prompt) args.push(opts.prompt);
      if (opts.contextPath) args.push("--context", opts.contextPath);
      break;
    case "codex-cloud":
      // Codex Cloud dispatches via GitHub issue creation, NOT a CLI command.
      // `codex run --cloud` does not exist. See:
      //   - docs/reference/codex-cloud-research-report.md
      //   - docs/research/R001-parallel-dispatch/draft.md §Q2
      //   - docs/research/R002-agent-backend-plugin/draft.md §Q2
      // Will be replaced by CloudAgentBackend adapter in F014 P3.
      throw new Error(
        "codex-cloud dispatch is not yet implemented. " +
          "Codex Cloud dispatches via GitHub integration, not CLI. " +
          "See docs/reference/codex-cloud-research-report.md",
      );

  }

  return { command, args, stdin };
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
): Promise<{ exitCode: number; logPath: string }> {
  const projectRoot = process.cwd();
  const executionRoot = opts.workDir || projectRoot;
  const workflowFile = path.resolve(projectRoot, opts.workflowPath);
  const workflowContent = fs.readFileSync(workflowFile, "utf-8");
  const { command, args, stdin } = buildCommand(opts, workflowContent);

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

    const child = spawn(command, args, {
      cwd: executionRoot,
      env: {
        ...process.env,
        ...(opts.contextPath
          ? { GWRK_CONTEXT: opts.contextPath }
          : {}),
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

    const processLine = (line: string) => {
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
      rl.on("line", processLine);
    }

    // Process stderr line by line (same formatting)
    if (child.stderr) {
      const rlErr = readline.createInterface({
        input: child.stderr,
        crlfDelay: Number.POSITIVE_INFINITY,
      });
      rlErr.on("line", processLine);
    }

    child.on("close", (code) => {
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      logStream.write(`\n# [END] ${new Date().toISOString()}\n`);
      logStream.write(`# Duration  : ${mins}m ${secs}s\n`);
      logStream.write(`# Exit Code : ${code ?? 1}\n`);
      logStream.end();
      resolve({ exitCode: code ?? 1, logPath });
    });

    child.on("error", () => {
      logStream.write("\n# [ERROR] Agent process failed to start\n");
      logStream.end();
      resolve({ exitCode: 1, logPath });
    });
  });
}

// ─── FR-019/020/021: Plugin Dispatch Boundary (ADR-006) ──────────

/**
 * FR-019: Input contract for dispatchToAgent().
 * Maps to ADR-006 AgentBackend.dispatch() input.
 */
export interface TaskDispatch {
  prompt?: string;
  agent?: AgentBackend | string;
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
 * FR-020: Exit code normalization table.
 * Maps proprietary CLI exit codes to gwrk standard (0/1/2/127) with errorType classification.
 */
const EXIT_CODE_MAP: Record<number, { exitCode: number; errorType: string }> = {
  53: { exitCode: 1, errorType: "turn_limit" },
  126: { exitCode: 1, errorType: "permission_denied" },
  137: { exitCode: 1, errorType: "killed" },
  143: { exitCode: 1, errorType: "terminated" },
};

/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Today: wraps spawn(cli, args). When F014 ships, internals are replaced by
 * pluginRegistry.getAgentBackend().dispatch() — no other code changes.
 */
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  const backend = (task.agent ?? "gemini") as AgentBackend;
  const startTime = Date.now();

  const opts: DispatchOptions = {
    backend,
    workflowPath: task.workflow ?? ".agents/workflows/gwrk-implement.md",
    featureDir: task.featureDir,
    prompt: task.prompt,
    workDir: task.workDir,
  };

  const { exitCode: rawExitCode, logPath } = await dispatchAgent(opts);
  const durationS = Math.round((Date.now() - startTime) / 1000);

  const mapped = EXIT_CODE_MAP[rawExitCode];
  const exitCode = mapped ? mapped.exitCode : (rawExitCode > 2 && rawExitCode !== 127 ? 1 : rawExitCode);
  const errorType = mapped?.errorType;

  return {
    exitCode,
    errorType,
    stdout: "",
    stderr: "",
    durationS,
    logPath,
  };
}
