import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { finishRun, startRun } from "../db/runs.js";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import { PlanStore } from "../engine/plan-store.js";
import { loadConfig } from "../utils/config.js";
import { banner, fail, success } from "../utils/format.js";
import { readStdin } from "../utils/output.js";

import {
  getCurrentBranch,
  getCurrentCommit,
  getDiffStats,
} from "../utils/git.js";
import { generateRunId, writeManifest } from "../utils/manifest.js";
import { resolveFeature } from "../utils/resolve-feature.js";
import { scaffoldFeature } from "../utils/scaffold-feature.js";
import { resolveProjectId } from "../utils/project-id.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const specifyCommand = new Command("spec")
  .description("Create or refine a feature specification")
  .addHelpText(
    "after",
    `
Examples:
  gwrk define spec "Add OAuth2 integration"                  # New feature, auto-numbered
  gwrk define spec 014 "Refine the plugin section"           # Rework existing
  gwrk define spec 047-ontology "Ontology Integration"       # New with explicit slug
  gwrk define spec 001-cli-core --refs docs/grounding/new-feature.md
  echo "Refine the authentication section" | gwrk define spec 001
`,
  )
  .argument("[feature]", "Feature ID (e.g. 014-plugin-system). Omit to create new.")
  .argument("[prompt]", "Feature description (new) or rework instructions (existing)")
  .option("--refs <path>", "Path to additional reference docs")
  .action(
    async (
      featureArg: string | undefined,
      prompt: string | undefined,
      opts: { refs?: string },
    ) => {
      await withSignal("define spec", async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const backend = config.agents.define;
        const specsDir = path.join(cwd, "specs");

        // Read prompt/stdin BEFORE resolution — we need the prompt to decide
        // whether a missing feature is an error or a creation intent.
        let effectiveInput = prompt;
        if (!effectiveInput && !process.stdin.isTTY) {
          const stdinContent = await readStdin();
          if (stdinContent.trim()) {
            effectiveInput = stdinContent.trim();
          }
        }

        // --- Resolve or scaffold the feature ---
        let feature: string;

        if (!featureArg) {
          // No feature arg → creation mode. Prompt is the description.
          if (!effectiveInput) {
            throw new CommandError(
              `Feature description required.\n\nTo create a new feature:\n  gwrk define spec "Description of the feature"`,
              2,
            );
          }
          const result = scaffoldFeature(specsDir, effectiveInput);
          feature = result.featureId;
          console.log(`Created: ${feature}`);
        } else {
          // Feature arg provided → try to resolve
          try {
            feature = resolveFeature(featureArg, cwd);
          } catch {
            // Not found. If prompt exists → scaffold with explicit slug.
            if (effectiveInput) {
              const result = scaffoldFeature(specsDir, effectiveInput, {
                shortName: featureArg.replace(/^\d+-/, "").length > 0
                  ? featureArg
                  : undefined,
                number: /^\d+$/.test(featureArg)
                  ? undefined // auto-number, featureArg is just a bare number with no slug
                  : undefined,
              });
              feature = result.featureId;
              console.log(`Created: ${feature}`);
            } else {
              throw new CommandError(
                `Feature "${featureArg}" not found.\n\nTo create a new feature:\n  gwrk define spec "${featureArg}" "Description of the feature"\n  gwrk define spec "Description of the feature"\n\nTo list available features:\n  gwrk project specs`,
                1,
              );
            }
          }
        }

        // Detect mode: rework (spec.md already has content) vs new
        const specDir = path.join(cwd, "specs", feature);
        const specFile = path.join(specDir, "spec.md");
        const specExists = fs.existsSync(specFile);
        const specHasContent = specExists && fs.readFileSync(specFile, "utf-8").trim().length > 0;
        // Template-only files don't count as "rework" — only files that have been
        // through at least one spec generation pass.
        const isRework = specHasContent && !fs.readFileSync(specFile, "utf-8").includes("{{FEATURE_NUMBER}}");

        // Build the effective prompt
        let effectivePrompt: string;
        if (isRework) {
          const reworkInstructions =
            effectiveInput || "Review and refine this specification";
          effectivePrompt = `REWORK existing spec for feature ${feature}.\n\nExisting spec: specs/${feature}/spec.md\n\nRework instructions: ${reworkInstructions}`;
        } else {
          if (!effectiveInput) {
            throw new CommandError(
              `No spec found at specs/${feature}/spec.md and no prompt provided.\nFor new specs, provide a description:\n  gwrk define spec ${feature} "Description of the feature"`,
              1,
            );
          }
          effectivePrompt = `Create a NEW spec for feature ${feature}.\n\nDescription: ${effectiveInput}`;
        }

        // Inject refs as authoritative source material.
        // Per Anthropic prompt structure: dynamic content goes BEFORE instructions,
        // wrapped in XML tags for clear content boundaries.
        // Per GPT-5.2 guide: repeated critical instructions at the end for long prompts.
        if (opts.refs) {
          const resolvedRefs = path.resolve(opts.refs);
          if (!fs.existsSync(resolvedRefs)) {
            throw new CommandError(
              `Reference file not found: ${opts.refs}\nResolved to: ${resolvedRefs}`,
              1,
            );
          }
          const refsContent = fs.readFileSync(resolvedRefs, "utf-8");
          effectivePrompt = [
            `<reference_document source="${opts.refs}" authority="primary">`,
            refsContent,
            `</reference_document>`,
            ``,
            effectivePrompt,
            ``,
            `CRITICAL REMINDER: The <reference_document> above is the AUTHORITATIVE source of requirements. Every screen name, role, data source, acceptance criterion, and technical constraint from the reference document MUST appear verbatim in the spec. Do NOT substitute generic defaults for specific names defined in the reference document.`,
          ].join("\n");
        }

        const mode = isRework ? "rework" : "new";

        const runId = startRun({
          feature_id: feature,
          command: "define spec",
          agent_backend: backend,
          workflow: "specify",
        });

        banner("define spec", {
          Agent: backend,
          Feature: feature,
          Mode: mode,
          ...(prompt
            ? {
                Prompt: `"${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"`,
              }
            : {}),
          "Run ID": `${runId}`,
          ...(opts.refs ? { Refs: opts.refs } : {}),
        });

        const startTime = Date.now();
        const startedAt = new Date().toISOString();

        try {
          const orchestrator = new DefineOrchestrator({
            featureId: feature,
            backend,
            cwd,
            refs: opts.refs,
          }, {
            stage: DefineStage.SPECIFY,
            featureId: feature,
            startedAt,
            runId: `define-spec-${feature}-${Date.now()}`,
            backend,
          });

          const exitCode = await orchestrator.runLoop(effectivePrompt, { stopAfterOne: true });

          if (exitCode !== 0) {
            throw new Error(`Workflow execution failed with exit code ${exitCode}`);
          }

          const durationS = Math.round((Date.now() - startTime) / 1000);
          finishRun(runId, { exit_code: 0, duration_s: durationS });
          success("define spec", durationS, runId);

          // Write Execution Manifest (ADR-003)
          try {
            const finishedAt = new Date().toISOString();
            const gitCommit = getCurrentCommit(cwd);
            const gitBranch = getCurrentBranch(cwd);
            const { filesChanged, linesAdded, linesDeleted } = getDiffStats(
              cwd,
              `${gitCommit}~1`,
            );

            const manifestId = generateRunId(startedAt, "define", "p00");
            const featureDir = path.join(cwd, "specs", feature);

            writeManifest(featureDir, {
              runId: manifestId,
              feature,
              phase: "p00",
              command: "define spec",
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

          const planStore = new PlanStore(resolveProjectId(cwd));
          planStore.handleDefineComplete({
            featureId: feature,
            status: "SPECIFIED",
          });
        } catch (err: unknown) {
          const durationS = Math.round((Date.now() - startTime) / 1000);
          const msg = err instanceof Error ? err.message : String(err);
          finishRun(runId, {
            exit_code: 1,
            duration_s: durationS,
          });
          fail("define spec", 1, durationS, runId);
          console.error(msg);
          process.exitCode = 1;
        }
      });
    },
  );
