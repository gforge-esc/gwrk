/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import { validatePlanGates } from "../engine/plan-gate-validator.js";
import { PlanStore } from "../engine/plan-store.js";
import { loadConfig } from "../utils/config.js";
import { banner, blocked, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import {
  commitPaths,
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import { resolveModelForTask } from "../utils/resolve-model.js";
import { CommandError, withSignal } from "../utils/signal.js";
import { withParentFlags } from "../utils/command-flags.js";

export const definePlanCommand = new Command("plan")
  .description("Create or amend an implementation plan for a feature")
  .addHelpText(
    "after",
    `
Examples:
  gwrk define plan 001                                       # New plan
  gwrk define plan 014 "Add research workflow phases"        # Amend existing
  gwrk define plan 001-cli-core --refs docs/grounding/
  cat discovery.json | gwrk define plan 001
`,
  )
  .argument("<feature>", "The feature directory under specs/")
  .argument("[prompt]", "Amendment instructions (when plan.md already exists)")
  .option("--refs <path>", "Path to additional reference docs")
  .option("--dry-run", "Print the command without executing")
  .action(async (featureArg, prompt: string | undefined, opts: { refs?: string; dryRun?: boolean }, command: Command) => {
    // --refs/--dry-run are also declared on `define`; without this merge commander
    // binds them to the parent and they are silently dropped here.
    opts = withParentFlags(opts, command);
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
      const model = resolveModelForTask("define", backend, projectRoot);

      // TC-007: Read stdin if piped (discovery JSON)
      let contextContent: string | undefined;
      if (!process.stdin.isTTY) {
        const stdinContent = await readStdin();
        if (stdinContent.trim()) {
          contextContent = stdinContent.trim();
        }
      }

      // Detect mode: amend (plan.md already has real content) vs new
      const planPath = path.join(featureDir, "plan.md");
      const planExists = fs.existsSync(planPath);
      const planContent = planExists ? fs.readFileSync(planPath, "utf-8") : "";
      const planHasContent = planContent.trim().length > 0;
      // Template-only files don't count as "rework" — only files that have been
      // through at least one plan generation pass.
      const isAmend = planHasContent && !planContent.includes("{{FEATURE_NUMBER}}");

      // Build the effective prompt
      let effectivePrompt: string;
      if (isAmend) {
        const amendInstructions = contextContent || prompt || "Add new phases for the updated spec requirements";
        effectivePrompt = `AMEND existing plan for feature ${feature}.\n\nExisting plan: specs/${feature}/plan.md\n\nAmendment instructions: ${amendInstructions}`;
      } else {
        effectivePrompt = `Plan implementation for feature ${feature}${contextContent ? `\n\nContext:\n${contextContent}` : ""}`;
      }

      const mode = isAmend ? "amend" : "new";

      // Inject refs as reference material
      if (opts.refs) {
        const resolvedRefs = path.resolve(opts.refs);
        if (!fs.existsSync(resolvedRefs)) {
          throw new CommandError(`Reference file not found: ${opts.refs}`);
        }
        const refsContent = fs.readFileSync(resolvedRefs, "utf-8");
        effectivePrompt = [
          `<reference_document source="${opts.refs}" authority="primary">`,
          refsContent,
          `</reference_document>`,
          ``,
          effectivePrompt,
          ``,
          `CRITICAL REMINDER: Use the reference document above as the authoritative source of truth.`,
        ].join("\n");
      }

      // A preview must leave no trace: `startRun` used to fire before anything
      // consulted --dry-run, leaving a run row that never finishes (NULL
      // exit_code). `runs` is what harvest correlates against and what
      // getShippedPhases reads, so a row for work that never happened is
      // false evidence. -1 is the same sentinel a failed ledger write uses.
      const runId = opts.dryRun ? -1 : startRun({
        feature_id: feature,
        command: "define plan",
        agent_backend: backend,
        workflow: "plan",
      });

      banner("define plan", {
        Feature: feature,
        Agent: backend,
        Mode: mode,
        "Run ID": opts.dryRun ? "dry-run" : `${runId}`,
        ...(opts.refs ? { Refs: opts.refs } : {}),
      });

      const startTime = Date.now();
      const startedAt = new Date().toISOString();
      let finished = false;

      try {
        const orchestrator = new DefineOrchestrator({
          featureId: feature,
          backend,
          model,
          cwd: projectRoot,
          refs: opts.refs,
          dryRun: opts.dryRun,
          quiet: true,
        }, {
          stage: DefineStage.PLAN,
          featureId: feature,
          startedAt,
          runId: `define-plan-${feature}-${Date.now()}`,
          backend,
        });

        const exitCode = await orchestrator.runLoop(effectivePrompt, { stopAfterOne: true });

        if (exitCode !== 0) {
          throw new Error(`Workflow execution failed with exit code ${exitCode}`);
        }

        if (opts.dryRun) {
          return;
        }

        // Before the clean commit, verify the generated plan has no gate defect
        // and fail loudly with error-as-navigation (ADR-004) so a false-green
        // plan never lands. Two kinds: 023 FR-006 hollow stubs, and 024 FR-003
        // output-as-pass assertions. Message branches by `kind`.
        const gateReport = validatePlanGates(featureDir, feature);
        if (!gateReport.ok) {
          const detail = gateReport.violations
            .map((v) =>
              v.kind === "output-as-pass"
                ? `define plan: ${v.phaseId} "${v.title}" Done-When asserts on output, not exit ('${v.offendingLine}'). Assert on the command's exit code (run it directly); to check a token, capture output to a file then grep the file. See specs/024-gate-assertion-contract/spec.md.`
                : `define plan: ${v.phaseId} "${v.title}" resolves to a stub gate (no executable Done-When). Author a fenced bash Done-When block. See docs/grounding/023-plan-format-contract.md.`,
            )
            .join("\n");
          throw new CommandError(detail, 1);
        }

        const durationS = Math.round((Date.now() - startTime) / 1000);
        finishRun(runId, { exit_code: 0, duration_s: durationS });
        finished = true;
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
            model: model || "unknown",
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

        // Commit ONLY the manifest we just wrote — never the caller's tree.
        commitPaths(projectRoot, `chore(${feature}): define plan execution manifest`, [
          path.join("specs", feature, ".gwrk", "runs"),
        ]);

        const planStore = new PlanStore(resolveProjectId(projectRoot));
        planStore.handleDefineComplete({
          featureId: feature,
          status: "DEFINED",
        });
      } catch (err: unknown) {
        const durationS = Math.round((Date.now() - startTime) / 1000);
        const msg = err instanceof Error ? err.message : String(err);
        if (!finished) {
          finishRun(runId, { exit_code: 1, duration_s: durationS });
        }
        fail("define plan", 1, durationS, runId);
        console.error(msg);
        process.exitCode = 1;
      }
    });
  });
