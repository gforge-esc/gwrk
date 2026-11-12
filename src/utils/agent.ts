/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import { recordRoutingDecision } from "../db/plugins.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { resolveExtensionContext } from "../plugins/extension-runtime.js";
import { PluginLoader } from "../plugins/loader.js";
import { resolveEnforcementSkills } from "../plugins/skill-runtime.js";
import type { AgentTaskRequest, AgentTaskResult } from "../ports/agent-port.js";
import { formatResultError, renderStreamStdoutLine } from "./agent-log.js";
import { type AgentBackendId, loadConfig } from "./config.js";
import { startProgress } from "./progress.js";
import { resolveProjectId } from "./project-id.js";

// ANSI — must match format.ts
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * ADR-008 Layer 2: Environment variables that mechanically prevent
 * interactive sub-processes from hanging agent sessions.
 */
export const SAFE_AGENT_ENV: Record<string, string> = {
  GIT_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_MERGE_AUTOEDIT: "no",
  DEBIAN_FRONTEND: "noninteractive",
  CI: "true",
  npm_config_yes: "true",
};

/**
 * ADR-008 Layer 1: Prompt block injected into every agent-dispatched
 * workflow. Tells the agent how to handle commands safely.
 */
export const COMMAND_SAFETY_BLOCK = `<command_safety>
RULES FOR EVERY COMMAND YOU RUN:
1. NEVER run interactive commands. All commands must complete without human input.
2. NEVER start long-running servers (pnpm dev, npm start, python -m http.server).
3. ALWAYS use non-interactive flags: --no-edit, --non-interactive, -y, --yes.
4. ALWAYS set GIT_EDITOR=true and EDITOR=true to prevent editor invocations.
5. If a command produces no output for 60 seconds, kill it (Ctrl-C) and retry
   with --non-interactive or equivalent flags.
6. If git merge output contains "CONFLICT", abort with git merge --abort
   and report the conflict. Do NOT attempt manual resolution.
7. Prefer timeout 120 <cmd> for any build or test command.
8. NEVER run: vim, nano, less, more, man, top, htop, watch, tail -f.
</command_safety>`;

/**
 * Normalized Exit Code Map (ADR-006)
 */
const EXIT_CODE_MAP: Record<number, number> = {
  53: 1, // Gemini turn limit
  42: 2, // Usage error
  126: 1, // Claude permission denied
  127: 127, // Command not found
};

interface DispatchOptions {
  backend: AgentBackendId | string;
  workflowPath: string;
  featureDir?: string;
  prompt?: string;
  model?: string;
  env?: Record<string, string>;
  approvalMode?: "yolo" | "auto" | "plan";
  contextPath?: string;
  workDir?: string;
  stdin?: string;
  quiet?: boolean;
  outputSchema?: Record<string, unknown>;
  /**
   * When true, the backend's stdout is a stream-json event stream: render it
   * into a readable .runs/*.log transcript and mirror the raw stream to a
   * .jsonl sidecar. When false/undefined, stdout is logged verbatim (the prior
   * behavior — preserved for prose backends like agy/codex).
   */
  emitsStreamJson?: boolean;
  prebuiltDispatch?: {
    command: string;
    args: string[];
    stdin?: string;
  };
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
    model: opts.model,
    env: opts.env,
    workflow: opts.workflowPath,
    featureDir: opts.featureDir,
    stdin: opts.stdin,
    outputSchema: opts.outputSchema,
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
 * Log a timestamped agent-output line ("HH:MM:SS +MM:SS") to the run log only.
 *
 * Agent stdout/stderr — including Claude Code's `--output-format json`
 * envelope — is intentionally NOT echoed to the terminal; doing so floods the
 * UX with raw JSON. The full transcript lives in the .runs/*.log file, and
 * callers surface their own curated progress (e.g. the elapsed heartbeat).
 */
function stampLine(
  line: string,
  startEpoch: number,
  logStream?: fs.WriteStream,
): void {
  if (!logStream) return;
  const stamp = formatStamp(startEpoch);
  logStream.write(`[${stamp}] ${line}\n`);
}

async function dispatchAgent(opts: DispatchOptions): Promise<{
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
  const { command, args, stdin } =
    opts.prebuiltDispatch ?? (await buildCommand(opts, workflowContent));

  // Set up .runs/ log file
  const runsDir = path.join(process.cwd(), ".runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  // Use parent directory name for plugin workflows (PROMPT.md → parent dir name)
  const rawWorkflow = path.basename(opts.workflowPath, ".md");
  const workflow =
    rawWorkflow === "PROMPT"
      ? path.basename(path.dirname(opts.workflowPath))
      : rawWorkflow;
  const rawFeature = opts.featureDir
    ? path.basename(opts.featureDir)
    : (opts.prompt ?? "unknown");
  const feature = rawFeature.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const logPath = path.join(runsDir, `${ts}_${workflow}_${feature}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  // Lossless raw event stream sidecar (stream-json backends only). The .log is
  // the readable transcript; this .jsonl is the complete record for replay and
  // exhaustive debugging.
  const jsonlPath = logPath.replace(/\.log$/, ".jsonl");
  const jsonlStream = opts.emitsStreamJson
    ? fs.createWriteStream(jsonlPath, { flags: "a" })
    : undefined;

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
    // Terminal stream-json `result` event, captured for end-of-run error surfacing.
    let lastResultEvent: unknown;

    // Write a (possibly multi-line) transcript entry, timestamping each line so
    // the log stays grep-able and stalls are visible by wall clock.
    const writeStamped = (text: string) => {
      const stamp = formatStamp(startEpoch);
      for (const l of text.split("\n")) {
        logStream.write(`[${stamp}] ${l}\n`);
      }
    };

    // ADR-008 Layer 2: Hardened environment for agent sub-processes
    const child = spawn(command, args, {
      cwd: executionRoot,
      env: {
        ...process.env,
        ...SAFE_AGENT_ENV,
        ...(opts.env ?? {}),
        ...(opts.contextPath ? { GWRK_CONTEXT: opts.contextPath } : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Quiet mode: progress indicator instead of streaming output. Animates
    // only on a terminal — redirected to a log it heartbeats once a minute.
    const progress = opts.quiet
      ? startProgress({
          label: "agent running",
          write: (chunk) => writeScopedStdout(chunk),
          isTTY: process.stdout.isTTY === true,
          frameMs: 200,
        })
      : undefined;

    if (child.stdin) {
      if (stdin) {
        child.stdin.write(stdin);
      }
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
        writeScopedStdout(
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

      // Stream-json backends (claude): mirror the raw stdout event to the
      // lossless .jsonl sidecar, then render a readable transcript entry into
      // the .log. Unparseable or unrecognized events fall back to the raw line
      // so nothing is silently dropped. stderr stays on the default path below
      // (plain diagnostics, not part of the event stream).
      if (opts.emitsStreamJson && stream === "stdout") {
        const routed = renderStreamStdoutLine(line);
        jsonlStream?.write(`${routed.jsonl}\n`);
        if (routed.resultEvent !== undefined) {
          lastResultEvent = routed.resultEvent;
        }
        writeStamped(routed.log);
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

      progress?.stop();
      const elapsed = Math.floor((Date.now() - startEpoch) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      logStream.write(`\n# [END] ${new Date().toISOString()}\n`);
      logStream.write(`# Duration  : ${mins}m ${secs}s\n`);
      logStream.write(`# Exit Code : ${code}\n`);
      logStream.end();
      jsonlStream?.end();

      if (opts.quiet) {
        const status = code === 0 ? "✓" : "✗";
        const relLogPath = path.relative(process.cwd(), logPath);
        writeScopedStdout(
          `  ${status} agent done (${mins}m ${secs}s) → ${relLogPath}\n`,
        );
        // Surface concise error context on failure (goal: helpful context, not
        // a log dump). Success stays a single clean line.
        const errSummary = formatResultError(lastResultEvent);
        if (code !== 0 || errSummary) {
          if (errSummary) {
            writeScopedStdout(`  ${YELLOW}⚠ ${errSummary}${RESET}\n`);
          }
          writeScopedStdout(
            `  ${DIM}↳ full transcript: ${relLogPath}${RESET}\n`,
          );
        }
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
export interface TaskDispatch extends AgentTaskRequest {
  promptParts?: { template: string; userInput: string };
  /** Project that selected the backend when execution uses a separate worktree. */
  backendProjectRoot?: string;
  commandOverride?: string;
  dryRun?: boolean;
}

export interface TaskResult extends AgentTaskResult {
  logPath?: string;
  /** True when the agent writes files directly via built-in tools. */
  nativeWriter?: boolean;
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

function resolvePrimaryCheckout(executionDir: string): string {
  try {
    const [firstField] = execFileSync(
      "git",
      ["worktree", "list", "--porcelain", "-z"],
      {
        cwd: executionDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).split("\0", 1);
    const prefix = "worktree ";
    if (firstField.startsWith(prefix)) {
      return firstField.slice(prefix.length) || executionDir;
    }
  } catch {
    return executionDir;
  }
  return executionDir;
}

const ENFORCEMENT_MARKER = "{{enforcement}}";

function maskMarkdownCode(template: string): string {
  // Keep offsets and line endings without turning quoted content into whitespace.
  const mask = (code: string) => code.replace(/[^\r\n]/g, "\0");
  const maskSpans = (text: string) =>
    text
      .replace(/^ {0,3}>[^\r\n]*/gm, mask)
      .split(/(\r?\n[ \t]*\r?\n)/)
      .map((paragraph) =>
        paragraph.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, mask),
      )
      .join("");

  let masked = "";
  let textStart = 0;
  let fence: { delimiter: string; start: number } | undefined;
  for (const { 0: line, 1: delimiter, 2: rest, index } of template.matchAll(
    /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/gm,
  )) {
    if (!fence) {
      if (delimiter[0] === "`" && rest.includes("`")) continue;
      masked += maskSpans(template.slice(textStart, index));
      fence = { delimiter, start: index };
    } else if (
      delimiter[0] === fence.delimiter[0] &&
      delimiter.length >= fence.delimiter.length &&
      !rest.trim()
    ) {
      textStart = index + line.length;
      masked += mask(template.slice(fence.start, textStart));
      fence = undefined;
    }
  }
  return (
    masked +
    (fence
      ? mask(template.slice(fence.start))
      : maskSpans(template.slice(textStart)))
  );
}

function findEnforcementSlot(
  template: string,
  fallback: "empty-section" | "scoped-legacy",
): RegExpMatchArray | undefined {
  const masked = maskMarkdownCode(template);
  const sections = [
    ...masked.matchAll(/<code_quality>([\s\S]*?)<\/code_quality>/g),
  ];
  const marked = sections.filter(([, body]) =>
    body.includes(ENFORCEMENT_MARKER),
  );
  if (marked.length > 0) return marked.length === 1 ? marked[0] : undefined;

  if (fallback === "scoped-legacy") {
    const bareMarkers = [
      ...masked.matchAll(/^\{\{enforcement\}\}(?=\r?\n|$)/gm),
    ];
    if (bareMarkers.length > 0) {
      return bareMarkers.length === 1 ? bareMarkers[0] : undefined;
    }
    const emptyLines = [
      ...masked.matchAll(
        /^<code_quality>\s*<\/code_quality>(?=[ \t]*(?:\r?\n|$))/gm,
      ),
    ];
    return emptyLines.length === 1 ? emptyLines[0] : undefined;
  }

  const emptySections = sections.filter(([, body]) => !body.trim());
  return emptySections.length === 1 ? emptySections[0] : undefined;
}

function findLegacyInputStart(stdin: string): number | undefined {
  // The transport closer can follow an unclosed fence in the task text.
  const closer = /(?<=^|\n)<\/user_input>(?=\r?\n|$)\s*$/.exec(stdin);
  if (!closer) return undefined;

  const prefix = maskMarkdownCode(stdin.slice(0, closer.index));
  const tags = [...prefix.matchAll(/^<(\/?)user_input>(?=\r?\n|$)/gm)];
  let depth = 1;
  for (const tag of tags.reverse()) {
    depth += tag[1] === "/" ? 1 : -1;
    if (depth === 0) return tag.index;
  }
  return undefined;
}

function splitLegacyStdin(task: TaskDispatch) {
  const { stdin, prompt, type, workflow } = task;
  if (
    !stdin ||
    stdin === prompt ||
    type?.startsWith("skill/") ||
    workflow?.startsWith("skill/") ||
    /^<user_input>(?=\r?\n|$)/.test(stdin.trimStart())
  ) {
    return undefined;
  }

  const inputStart = findLegacyInputStart(stdin);
  if (inputStart === undefined) {
    const slot = findEnforcementSlot(stdin, "empty-section");
    if (
      slot?.index !== undefined &&
      stdin.trim() === stdin.slice(slot.index, slot.index + slot[0].length)
    ) {
      return { template: stdin, userInput: "", slot };
    }
    return undefined;
  }

  const template = stdin.slice(0, inputStart);
  const slot = findEnforcementSlot(template, "scoped-legacy");
  return slot && { template, userInput: stdin.slice(inputStart), slot };
}

/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Internals are replaced by pluginRegistry.getAgentBackend().dispatch()
 */
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  const projectRoot = task.workDir ?? process.cwd();
  try {
    const primaryCheckout = resolvePrimaryCheckout(projectRoot);
    const config = loadConfig(primaryCheckout);
    const throttleMs = config.agents.throttleMs ?? 0;

    if (throttleMs > 0) {
      const runsDir = path.join(primaryCheckout, ".runs");
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
        writeScopedStdout(
          `\x1b[2m\x1b[33m⏳ Metering API limits (waiting ${waitSecs}s)...\x1b[0m\n`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      fs.writeFileSync(statePath, Date.now().toString(), "utf-8");
    }
  } catch (e) {
    // Ignore config errors here, allow dispatch to proceed
  }

  const agentName = (task.agent ?? "agy") as string;
  const { promptParts, backendProjectRoot, ...agentTask } = task;
  const registry = new AgentBackendRegistry(
    new PluginLoader({ projectDir: backendProjectRoot ?? projectRoot }),
  );
  const adapter = await registry.getAgentBackend(agentName);

  const startTime = Date.now();
  const legacyParts = promptParts ? undefined : splitLegacyStdin(task);
  let template = promptParts?.template ?? legacyParts?.template ?? "";

  // FR-014: Inject enforcement skills
  const enforcementSlot = promptParts
    ? findEnforcementSlot(template, "empty-section")
    : legacyParts?.slot;
  if (enforcementSlot?.index !== undefined) {
    const scope =
      task.workflow?.includes("review") || task.type?.includes("review")
        ? "review"
        : "implementation";

    // R007: Detect project profile for language-aware enforcement routing
    const { detectProfile } = await import("../engine/profile-detector.js");
    const profile = await detectProfile(projectRoot);

    const enforcement = await resolveEnforcementSkills(
      projectRoot,
      scope,
      profile,
    );

    const start = enforcementSlot.index;
    const [maskedSlot] = enforcementSlot;
    const end = start + maskedSlot.length;
    const originalSlot = template.slice(start, end);
    const replacement = maskedSlot.includes(ENFORCEMENT_MARKER)
      ? originalSlot.replaceAll(ENFORCEMENT_MARKER, (marker, offset: number) =>
          maskedSlot.startsWith(marker, offset) ? enforcement : marker,
        )
      : `<code_quality>\n${enforcement}\n</code_quality>`;
    template = template.slice(0, start) + replacement + template.slice(end);
  }

  const hasCommandSafety = promptParts?.template.includes(COMMAND_SAFETY_BLOCK);
  let stdinPayload = (
    promptParts
      ? [template, promptParts.userInput]
      : [
          task.prompt === task.stdin ? undefined : task.prompt,
          legacyParts ? template + legacyParts.userInput : task.stdin,
        ]
  )
    .filter(Boolean)
    .join("\n\n");

  // ADR-009: Inject project knowledge documents (grounding)
  const workDir = projectRoot;
  const groundingFiles = [
    {
      path: path.join(workDir, ".gwrk/architecture.md"),
      tag: "architecture_target",
    },
    {
      path: path.join(workDir, ".gwrk/ontology/domain.md"),
      tag: "domain_ontology",
    },
    {
      path: path.join(workDir, ".gwrk/perspective/hierarchy.md"),
      tag: "information_hierarchy",
    },
    {
      path: path.join(workDir, ".gwrk/perspective/ux-posture.md"),
      tag: "ux_posture",
    },
    {
      path: path.join(workDir, ".gwrk/decisions/index.md"),
      tag: "architecture_decisions",
    },
  ];

  let grounding = "";
  for (const { path: filePath, tag } of groundingFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        grounding += `<${tag}>\n${content}\n</${tag}>\n\n`;
        if (!task.quiet) {
          writeScopedStdout(`${DIM}  → Grounding: <${tag}> injected${RESET}\n`);
        }
      } catch (err) {
        if (!task.quiet) {
          writeScopedStdout(
            `${DIM}  ⚠ Grounding: <${tag}> unreadable (${err instanceof Error ? err.message : err})${RESET}\n`,
          );
        }
      }
    }
  }

  if (grounding) {
    stdinPayload = `${grounding}${stdinPayload}`;
  }

  // Layer 3: External Context Injection (Phase 21)
  const rawKeywordSource = [
    task.featureDir ?? "",
    promptParts?.userInput ?? task.prompt ?? task.stdin ?? "",
  ]
    .join(" ")
    .replace(/^specs\//, "")
    .replace(/^\d+-/, " ");
  const extKeywords = Array.from(
    new Set(
      rawKeywordSource
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  ).slice(0, 12);
  const extContext =
    extKeywords.length > 0
      ? await resolveExtensionContext(workDir, extKeywords)
      : await resolveExtensionContext(workDir);
  if (extContext.length > 0) {
    const contextContent = extContext
      .map((res) => `<${res.source}>\n${res.content}\n</${res.source}>`)
      .join("\n\n");
    stdinPayload = `${stdinPayload}\n\n<external_context>\n${contextContent}\n</external_context>`;
  }

  // ADR-008 Layer 1: Inject <command_safety> block into prompt stdin
  if (stdinPayload && !hasCommandSafety) {
    stdinPayload = `${COMMAND_SAFETY_BLOCK}\n\n${stdinPayload}`;
  }

  const dispatch = await adapter.dispatch({
    ...agentTask,
    prompt: undefined,
    stdin: stdinPayload || undefined,
  });
  if (
    stdinPayload &&
    dispatch.stdin &&
    !dispatch.stdin.includes(stdinPayload)
  ) {
    dispatch.stdin = `${stdinPayload}\n${dispatch.stdin}`;
  } else if (!dispatch.stdin && stdinPayload) {
    dispatch.stdin = stdinPayload;
  }

  if (task.dryRun) {
    return {
      exitCode: 0,
      stdout: dispatch.stdin ?? "",
      unwrappedStdout: dispatch.stdin ?? "",
      stderr: "",
      durationS: 0,
    };
  }

  const opts: DispatchOptions = {
    backend: agentName as AgentBackendId,
    workflowPath: await resolveWorkflowPath(task.workflow ?? "gwrk-implement"),
    featureDir: task.featureDir,
    prompt: task.prompt,
    model: task.model,
    env: dispatch.env ?? task.env,
    workDir: task.workDir,
    outputSchema: task.outputSchema,
    emitsStreamJson: adapter.emitsStreamJson,
    prebuiltDispatch: {
      command: dispatch.command,
      args: dispatch.args,
      stdin: dispatch.stdin,
    },
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
    nativeWriter: adapter.nativeWriter ?? false,
  };
}
