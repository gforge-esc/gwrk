import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import { PlanStore } from "../engine/plan-store.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const planCommand = new Command("plan")
  .description("Create an implementation plan for a feature")
  .addHelpText(
    "after",
    `
Examples:
  gwrk define plan 001
  gwrk define plan 001-cli-core --refs docs/grounding/
  cat discovery.json | gwrk define plan 001
`,
  )
  .argument("<feature>", "The feature directory under specs/")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (featureArg, opts: { refs?: string }) => {
    await withSignal("define plan", async () => {
      const projectRoot = process.cwd();
      const feature = resolveFeature(featureArg, projectRoot);
      const relativeFeatureDir = path.join("specs", feature);
      const featureDir = path.join(projectRoot, relativeFeatureDir);
      const specPath = path.join(featureDir, "spec.md");

      if (!fs.existsSync(specPath)) {
        blocked("spec.md not found");
        throw new CommandError(
          "spec.md not found. Run 'gwrk define spec <feature>' to create. See 'gwrk project specs' for available features.",
          1,
        );
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
      let contextContent: string | undefined;
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();
        if (stdinContent.trim()) {
          contextContent = stdinContent.trim();
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
      });

      const startTime = Date.now();
      const startedAt = new Date().toISOString();

      try {
        const input = `Plan implementation for feature ${feature}${contextContent ? `\n\nContext:\n${contextContent}` : ""}${opts.refs ? `\n\nReference: ${opts.refs}` : ""}`;
        
        const orchestrator = new DefineOrchestrator({
          featureId: feature,
          backend,
          cwd: projectRoot,
          refs: opts.refs,
        }, {
          stage: DefineStage.PLAN,
          featureId: feature,
          startedAt,
          runId: `define-plan-${feature}-${Date.now()}`,
          backend,
        });

        const exitCode = await orchestrator.runLoop(input, { stopAfterOne: true });

        if (exitCode !== 0) {
          throw new Error(`Workflow execution failed with exit code ${exitCode}`);
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        success("define plan", durationS, runId);

        // Write Execution Manifest (ADR-003)
        try {
          const finishedAt = new Date().toISOString();
          const gitCommit = getCurrentCommit(projectRoot);
          const gitBranch = getCurrentBranch(projectRoot);
          const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
            projectRoot,
            `${gitCommit}~1`,
          );

          const manifestId = generateRunId(startedAt, "define", "p00");
          const featureDir = path.join(projectRoot, "specs", feature);

          writeManifest(featureDir, {
            runId: manifestId,
            feature,
            phase: "p00",
            command: "define plan",
            agent: backend,
            model: "unknown",
            startedAt,
            finishedAt,
            durationS,
            exitCode: 0,
            attempt: 1,
            filesChanged,
            linesAdded,
            linesDeleted,
            gitCommit,
            gitBranch,
            digest: [],
          });
        } catch (manifestError) {
          console.warn(
            `Warning: Could not write execution manifest: ${manifestError}`,
          );
        }

        const planStore = new PlanStore(resolveProjectId(projectRoot));
        planStore.handleDefineComplete({
          featureId: feature,
          status: "DEFINED",
        });
      } catch (err: unknown) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const msg = err instanceof Error ? err.message : String(err);
        finishRun(runId, { exit_code: 1, duration_s: durationS });
        fail("define plan", 1, durationS, runId);
        console.error(msg);
        process.exitCode = 1;
      }
    });
  });
