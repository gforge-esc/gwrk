/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
import { resolveModelForTask } from "../utils/resolve-model.js";

import {
  commitAllClean,
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

  New feature (name auto-generated from description):
    gwrk define spec "Add OAuth2 integration"

  New feature (explicit name + description):
    gwrk define spec "oauth2-integration" "Add OAuth2 support with PKCE flow"

  Rework an existing spec:
    gwrk define spec 014 "Refine the plugin section"
    gwrk define spec 014-plugin-system "Add enforcement skill scaffolding"

  With reference docs:
    gwrk define spec "Polyglot monorepo" --refs docs/research/R010/draft.md
    gwrk define spec 020 --refs docs/research/R010/draft.md

  Via stdin:
    echo "Refine the authentication section" | gwrk define spec 001

Arguments:
  The first argument is EITHER:
    - A feature name/slug for a NEW feature ("oauth2-integration")
    - A feature ID for an EXISTING feature (014 or 014-plugin-system)
  When only one argument is given, it is treated as the description
  and the feature name is auto-generated from it.
`,
  )
  .argument("[feature-name-or-id]", "Feature name/slug (new) or feature ID (existing). Omit to auto-generate from description.")
  .argument("[description]", "Feature description (new) or rework instructions (existing)")
  .option("--refs <path>", "Path to additional reference docs")
  .option("--dry-run", "Print the command without executing")
  .action(
    async (
      featureArg: string | undefined,
      prompt: string | undefined,
      opts: { refs?: string; dryRun?: boolean },
    ) => {
      await withSignal("define spec", async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const backend = config.agents.define;
        const model = resolveModelForTask("define", backend, cwd);
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
              `Feature description required.\n\nUsage:\n  gwrk define spec "Description of the feature"          # auto-names from description\n  gwrk define spec "feature-name" "Description"           # explicit name + description\n  echo "description" | gwrk define spec                   # via stdin`,
              2,
            );
          }
          if (opts.dryRun) {
            feature = "dry-run-feature";
          } else {
            const result = scaffoldFeature(specsDir, effectiveInput);
            feature = result.featureId;
            console.log(`Created: ${feature}`);
          }
        } else {
          // Feature arg provided → try to resolve
          try {
            feature = resolveFeature(featureArg, cwd);
          } catch {
            // Not found. If prompt exists → scaffold with explicit slug.
            if (effectiveInput) {
              if (opts.dryRun) {
                feature = featureArg;
              } else {
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
              }
            } else {
              throw new CommandError(
                `Feature "${featureArg}" not found and no description was provided.\n\nDid you mean to create a new feature?\n  gwrk define spec "${featureArg}" "What this feature does"\n                     ↑ name/slug       ↑ description\n\nOr did you mean this as the description? Omit the name to auto-generate:\n  gwrk define spec "${featureArg}"\n                     ↑ treated as description, name auto-generated\n\nTo rework an existing feature, use its ID:\n  gwrk project specs                         # list available features`,
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
            model,
            cwd,
            refs: opts.refs,
            dryRun: opts.dryRun,
            quiet: true,
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

          if (opts.dryRun) {
            return;
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

          // Define must always leave a clean working tree
          commitAllClean(cwd, `chore(${feature}): define spec execution manifest`);

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
