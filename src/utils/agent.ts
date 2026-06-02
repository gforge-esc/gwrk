import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { recordRoutingDecision } from "../db/plugins.js";
import { resolveProjectId } from "./project-id.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { PluginLoader } from "../plugins/loader.js";
import { resolveEnforcementSkills } from "../plugins/skill-runtime.js";
import {
  type AgentBackend as ConfigAgentBackend,
  loadConfig,
} from "./config.js";

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
  quiet?: boolean;
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

/** Format elapsed stamp: "HH:MM:SS +MM:SS" */
function formatStamp(startEpoch: number): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
  const eMin = Math.floor(elapsed / 60);
  const eSec = elapsed % 60;
  return `${hh}:${mm}:${ss} +${String(eMin).padStart(2, "0")}:${String(eSec).padStart(2, "0")}`;
}

/**
 * Prefixes each output line with "HH:MM:SS +MM:SS" (wall clock + elapsed).
 * Writes timestamped output to both terminal and log file.
 */
function stampLine(
  line: string,
  startEpoch: number,
  logStream?: fs.WriteStream,
): void {
  const stamp = formatStamp(startEpoch);
  process.stdout.write(`${DIM}${stamp}${RESET}  ${line}\n`);

  // Tee timestamped output to log file (plain text, no ANSI)
  if (logStream) {
    logStream.write(`[${stamp}] ${line}\n`);
  }
}

export async function dispatchAgent(opts: DispatchOptions): Promise<{
  exitCode: number;
  logPath: string;
  stdout: string;
  stderr: string;
}> {
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

    // Quiet mode: spinner instead of streaming output
    const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let spinnerIdx = 0;
    let spinnerInterval: ReturnType<typeof setInterval> | undefined;
    if (opts.quiet) {
      spinnerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const frame = SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length];
        spinnerIdx++;
        process.stdout.write(
          `\r${DIM}${frame} agent running... ${mins}m ${secs}s${RESET}  `,
        );
      }, 200);
    }

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

      // Quiet mode: write timestamped line to log only, skip stdout
      if (opts.quiet) {
        if (logStream) {
          logStream.write(`[${formatStamp(startEpoch)}] ${line}\n`);
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

    let resolved = false;
    const finish = (code: number) => {
      if (resolved) return;
      resolved = true;

      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        process.stdout.write("\r\x1b[K");
      }
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      logStream.write(`\n# [END] ${new Date().toISOString()}\n`);
      logStream.write(`# Duration  : ${mins}m ${secs}s\n`);
      logStream.write(`# Exit Code : ${code}\n`);
      logStream.end();

      if (opts.quiet) {
        const status = code === 0 ? "✓" : "✗";
        const relLogPath = path.relative(process.cwd(), logPath);
        process.stdout.write(
          `  ${status} agent done (${mins}m ${secs}s) → ${relLogPath}\n`,
        );
      }

      resolve({
        exitCode: code,
        logPath,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      });
    };

    // Primary: close fires when all stdio FDs are drained (normal path)
    child.on("close", (code) => finish(code ?? 1));

    // Fallback: Node 25 readline holds FDs open after process exit.
    // If close hasn't fired within 30s of exit, force-resolve.
    // No overall timeout — agents can run as long as needed.
    child.on("exit", (code) => {
      setTimeout(() => {
        if (!resolved) {
          logStream.write(
            "# [FM-5] close did not fire 30s after exit — forcing resolution\n",
          );
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish(code ?? 1);
        }
      }, 30_000);
    });

    child.on("error", () => {
      logStream.write("\n# [ERROR] Agent process failed to start\n");
      finish(1);
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
  model?: string;
  commandOverride?: string;
  workDir?: string;
  stdin?: string;
  env?: Record<string, string>;
  workflow?: string;
  featureDir?: string;
  quiet?: boolean;
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
 * Resolves a workflow name to its actual file path.
 * Uses PluginLoader to check builtins and ~/.gwrk/ plugins.
 * Falls back to returning the input as-is if it looks like a path (backwards compat).
 */
async function resolveWorkflowPath(workflowName: string): Promise<string> {
  // If it looks like an existing file path, use it directly (backwards compat)
  if (
    workflowName.includes("/") &&
    fs.existsSync(path.resolve(process.cwd(), workflowName))
  ) {
    return workflowName;
  }

  // Strip .md extension and directory prefix for resolution
  const name = workflowName.replace(/\.md$/, "").replace(/^.*\//, "");

  try {
    const loader = new PluginLoader();
    const plugin = await loader.resolvePlugin(name);
    if (plugin.manifest.type === "workflow") {
      const promptPath = path.join(plugin.path, "PROMPT.md");
      if (fs.existsSync(promptPath)) {
        return promptPath;
      }
    }
  } catch {
    // Try with gwrk- prefix if not already present
    if (!name.startsWith("gwrk-")) {
      try {
        const loader = new PluginLoader();
        const plugin = await loader.resolvePlugin(`gwrk-${name}`);
        if (plugin.manifest.type === "workflow") {
          const promptPath = path.join(plugin.path, "PROMPT.md");
          if (fs.existsSync(promptPath)) {
            return promptPath;
          }
        }
      } catch {
        // Fall through
      }
    }
  }

  // Final fallback: return name as-is (dispatchAgent handles missing file gracefully)
  return workflowName;
}

/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Internals are replaced by pluginRegistry.getAgentBackend().dispatch()
 */
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  const projectRoot = process.cwd();
  try {
    const config = loadConfig(projectRoot);
    const throttleMs = config.agents.throttleMs ?? 0;

    if (throttleMs > 0) {
      const runsDir = path.join(projectRoot, ".runs");
      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
      }
      const statePath = path.join(runsDir, "last-dispatch.state");
      let lastDispatch = 0;
      if (fs.existsSync(statePath)) {
        lastDispatch =
          Number.parseInt(fs.readFileSync(statePath, "utf-8"), 10) || 0;
      }
      const now = Date.now();
      if (now - lastDispatch < throttleMs) {
        const wait = throttleMs - (now - lastDispatch);
        const waitSecs = Math.ceil(wait / 1000);
        process.stdout.write(
          `\x1b[2m\x1b[33m⏳ Metering API limits (waiting ${waitSecs}s)...\x1b[0m\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      fs.writeFileSync(statePath, Date.now().toString(), "utf-8");
    }
  } catch (e) {
    // Ignore config errors here, allow dispatch to proceed
  }

  const agentName = (task.agent ?? "gemini") as string;
  const registry = new AgentBackendRegistry(new PluginLoader());
  const adapter = await registry.getAgentBackend(agentName);

  const startTime = Date.now();
  const dispatch = await adapter.dispatch(task);

  // FR-014: Inject enforcement skills
  const hasEnforcementPlaceholder = dispatch.stdin.includes("{{enforcement}}");
  const hasCodeQualitySection = dispatch.stdin.includes("<code_quality>");

  if (hasEnforcementPlaceholder || hasCodeQualitySection) {
    const scope =
      task.workflow?.includes("review") || task.type?.includes("review")
        ? "review"
        : "implementation";
    const enforcement = await resolveEnforcementSkills(
      task.workDir || projectRoot,
      scope as "implementation" | "review",
    );

    if (hasEnforcementPlaceholder) {
      dispatch.stdin = dispatch.stdin.replace("{{enforcement}}", enforcement);
    } else if (hasCodeQualitySection) {
      // Inject into the section if no placeholder but tag exists
      dispatch.stdin = dispatch.stdin.replace(
        /<code_quality>([\s\S]*?)<\/code_quality>/,
        `<code_quality>\n${enforcement}\n</code_quality>`,
      );
    }
  }

  const opts: DispatchOptions = {
    backend: agentName as ConfigAgentBackend,
    workflowPath: await resolveWorkflowPath(task.workflow ?? "gwrk-implement"),
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
    quiet: task.quiet,
  });
  const durationS = Math.round((Date.now() - startTime) / 1000);

  const result = adapter.parseResult(stdout, stderr, rawExitCode);

  // Record routing decision for historical learning
  const taskType =
    task.type || path.basename(task.workflow || "unknown", ".md");
  const projectId = resolveProjectId(projectRoot);
  recordRoutingDecision(
    {
      task_type: taskType,
      selected_backend: agentName,
      outcome: result.exitCode === 0 ? "success" : "failure",
      duration_ms: durationS * 1000,
      error_message: result.errorType ?? undefined,
    },
    projectId,
  );

  return {
    ...result,
    durationS,
    logPath,
  };
}
