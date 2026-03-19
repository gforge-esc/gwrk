import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";
export const planCommand = new Command("plan")
    .description("Create an implementation plan for a feature")
    .argument("<feature>", "The feature directory under specs/")
    .option("--refs <path>", "Path to additional reference docs")
    .action(async (feature, opts) => {
    await withSignal("define plan", async () => {
        const projectRoot = process.cwd();
        const relativeFeatureDir = path.join("specs", feature);
        const featureDir = path.join(projectRoot, relativeFeatureDir);
        const specPath = path.join(featureDir, "spec.md");
        if (!fs.existsSync(specPath)) {
            blocked("spec.md not found");
            throw new CommandError("spec.md not found. Run 'gwrk define spec <feature>' to create. See 'gwrk project specs' for available features.", 1);
        }
        const specContent = fs.readFileSync(specPath, "utf-8");
        if (/^>?\s*\*\*Status:\*\*\s*Stub/im.test(specContent)) {
            const msg = `Spec ${feature} is marked as a Stub. Run 'gwrk define spec ${feature}' first.`;
            blocked(msg);
            throw new CommandError(msg, 1);
        }
        const config = loadConfig(projectRoot);
        const backend = config.agents.define;
        // TC-007: Read stdin if piped (discovery JSON)
        let contextPath;
        if (!process.stdin.isTTY) {
            const stdinContent = await readStdin();
            if (stdinContent.trim()) {
                try {
                    // Verify valid JSON
                    JSON.parse(stdinContent);
                    const hash = Date.now();
                    contextPath = `/tmp/gwrk-discovery-${hash}.json`;
                    fs.writeFileSync(contextPath, stdinContent);
                }
                catch (e) {
                    // Ignore if not valid JSON
                }
            }
        }
        const runId = startRun({
            feature_id: feature,
            command: "define plan",
            agent_backend: backend,
            workflow: "plan",
        });
        banner("define plan", {
            Feature: feature,
            Agent: backend,
            "Run ID": `${runId}`,
            ...(opts.refs ? { Refs: opts.refs } : {}),
            ...(contextPath ? { Context: contextPath } : {}),
        });
        const startTime = Date.now();
        const result = await dispatchAgent({
            backend,
            workflowPath: ".agents/workflows/gwrk-plan.md",
            featureDir: relativeFeatureDir,
            contextPath,
        });
        const durationS = Math.round((Date.now() - startTime) / 1000);
        if (result.exitCode !== 0) {
            finishRun(runId, { exit_code: result.exitCode, duration_s: durationS });
            fail("define plan", result.exitCode, durationS, runId, result.logPath);
            process.exitCode = result.exitCode;
            return;
        }
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("define plan", durationS, runId, result.logPath);
    });
});
