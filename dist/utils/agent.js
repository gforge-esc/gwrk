import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { BUILTIN_AGENTS } from "../plugins/builtins/agents/index.js";
// ANSI — must match format.ts
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";
/** Build the command + args for a given backend. Exported for testability. */
export async function buildCommand(opts, _workflowContent) {
    const agentName = opts.backend;
    const adapter = BUILTIN_AGENTS[agentName];
    if (adapter) {
        const task = {
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
    // Fallback to legacy logic for unknown backends if any
    const args = [];
    let command = "";
    let stdin = opts.stdin;
    // Extract slash command name from workflow path: .agents/workflows/gwrk-plan.md → /plan
    const workflowName = path.basename(opts.workflowPath, ".md");
    switch (opts.backend) {
        case "gemini": {
            command = "gemini";
            // Build the slash command string matching agent-run.sh:
            //   gemini -p "/plan specs/001-cli-core" --approval-mode yolo
            let slashCmd = `/${workflowName}`;
            if (opts.featureDir)
                slashCmd += ` ${opts.featureDir}`;
            if (opts.prompt)
                slashCmd += ` ${opts.prompt}`;
            args.push("-p", slashCmd);
            // Approval mode: analyze is read-only (plan mode), everything else is yolo
            const mode = opts.approvalMode ?? (workflowName.endsWith("analyze") ? "plan" : "yolo");
            args.push("--approval-mode", mode);
            break;
        }
        case "claude":
            command = "claude";
            args.push("-p", _workflowContent, "--output-format", "json");
            if (opts.featureDir)
                args.push(opts.featureDir);
            if (opts.prompt)
                args.push(opts.prompt);
            if (opts.contextPath)
                args.push("--context", opts.contextPath);
            break;
        case "codex":
            command = "codex";
            args.push("exec", "--full-auto", opts.workflowPath);
            if (opts.featureDir)
                args.push(opts.featureDir);
            if (opts.prompt)
                args.push(opts.prompt);
            if (opts.contextPath)
                args.push("--context", opts.contextPath);
            break;
        default:
            throw new Error(`Unsupported agent backend: ${opts.backend}`);
    }
    return { command, args, stdin };
}
/**
 * Prefixes each output line with "HH:MM:SS +MM:SS" (wall clock + elapsed).
 * Also writes raw (un-timestamped) line to the log file.
 */
function stampLine(line, startEpoch, logStream) {
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
export async function dispatchAgent(opts) {
    const projectRoot = process.cwd();
    const executionRoot = opts.workDir || projectRoot;
    const workflowFile = path.resolve(projectRoot, opts.workflowPath);
    const workflowContent = fs.readFileSync(workflowFile, "utf-8");
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
        const processLine = (line) => {
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
/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Internals are replaced by pluginRegistry.getAgentBackend().dispatch()
 */
export async function dispatchToAgent(task) {
    const agentName = (task.agent ?? "gemini");
    const adapter = BUILTIN_AGENTS[agentName];
    if (!adapter) {
        throw new Error(`Agent backend '${agentName}' not found.`);
    }
    const startTime = Date.now();
    const dispatch = await adapter.dispatch(task);
    const opts = {
        backend: agentName,
        workflowPath: task.workflow ?? ".agents/workflows/gwrk-implement.md",
        featureDir: task.featureDir,
        prompt: task.prompt,
        workDir: task.workDir,
    };
    const { exitCode: rawExitCode, logPath } = await dispatchAgent({
        ...opts,
        stdin: dispatch.stdin,
    });
    const durationS = Math.round((Date.now() - startTime) / 1000);
    // Note: we need stdout/stderr from dispatchAgent to call parseResult correctly.
    // Currently dispatchAgent only returns exitCode and logPath because it streams output.
    // In the future, we might need to capture output if parseResult needs it.
    const result = adapter.parseResult("", "", rawExitCode);
    return {
        ...result,
        durationS,
        logPath,
    };
}
