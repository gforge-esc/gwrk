import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
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
}

/** Build the command + args for a given backend. Exported for testability. */
export function buildCommand(opts: DispatchOptions, _workflowContent: string): {
  command: string;
  args: string[];
  stdin?: string;
} {
  const args: string[] = [];
  let command = "";
  let stdin: string | undefined;

  // Extract slash command name from workflow path: .agent/workflows/plan.md → /plan
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
      const mode = opts.approvalMode ?? (workflowName === "analyze" ? "plan" : "yolo");
      args.push("--approval-mode", mode);
      break;
    }
    case "claude":
      command = "claude";
      args.push("-p", _workflowContent, "--output-format", "json");
      if (opts.featureDir) args.push(opts.featureDir);
      if (opts.prompt) args.push(opts.prompt);
      break;
    case "codex":
      command = "codex";
      args.push("exec", "--full-auto", opts.workflowPath);
      if (opts.featureDir) args.push(opts.featureDir);
      if (opts.prompt) args.push(opts.prompt);
      break;
    case "codex-cloud":
      command = "codex";
      args.push("run", "--cloud", "--non-interactive", "--full-auto", opts.workflowPath);
      if (opts.featureDir) args.push(opts.featureDir);
      if (opts.prompt) args.push(opts.prompt);
      break;
  }

  return { command, args, stdin };
}

/**
 * Prefixes each output line with "HH:MM:SS +MM:SS" (wall clock + elapsed).
 * Also writes raw (un-timestamped) line to the log file.
 */
function stampLine(line: string, startEpoch: number, logStream?: fs.WriteStream): void {
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
  const workflowFile = path.resolve(projectRoot, opts.workflowPath);
  const workflowContent = fs.readFileSync(workflowFile, "utf-8");
  const { command, args, stdin } = buildCommand(opts, workflowContent);

  // Set up .runs/ log file
  const runsDir = path.join(projectRoot, ".runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const workflow = path.basename(opts.workflowPath, ".md");
  const rawFeature = opts.featureDir ? path.basename(opts.featureDir) : opts.prompt ?? "unknown";
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
  logStream.write("# ────────────────────────────────────────\n\n");

  return new Promise((resolve) => {
    const startEpoch = Date.now();

    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
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
        process.stdout.write(`${DIM}${stamp}${RESET}  ${YELLOW}⏳ 429 — Rate limited (attempt ${attempt}), retrying…${RESET}\n`);
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
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      rl.on("line", processLine);
    }

    // Process stderr line by line (same formatting)
    if (child.stderr) {
      const rlErr = readline.createInterface({ input: child.stderr, crlfDelay: Number.POSITIVE_INFINITY });
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
