/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import {
  renderAssessment,
  renderFeature,
  validateAssessment,
} from "../domain/architecture-assessment.js";
import { writeIndex } from "../engine/adr-index.js";
import { parseCorpus } from "../engine/adr-parser.js";
import {
  findProjectRoot,
  resolveDecisionsDir,
} from "../engine/adr-scaffold.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";
import { PluginLoader } from "../plugins/loader.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { resolveAgent } from "../utils/resolve-agent.js";
import { CommandError, withSignal } from "../utils/signal.js";

export interface AssessOptions {
  cwd?: string;
  output?: string;
  refs?: string[];
  backend?: string;
  model?: string;
  print?: boolean;
  fromLog?: string;
  targetSnapshot?: string;
}
export async function assessProject(options: AssessOptions = {}) {
  const root = await findProjectRoot(options.cwd ?? process.cwd());
  if (options.targetSnapshot && !options.fromLog)
    throw new CommandError("--target-snapshot requires --from-log.");
  const target = await fs
    .readFile(
      options.targetSnapshot
        ? path.resolve(root, options.targetSnapshot)
        : path.join(root, ".gwrk/architecture.md"),
      "utf8",
    )
    .catch(() => {
      throw new CommandError(
        "Architecture context missing. Run gwrk init first.",
      );
    });
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, ".gwrk/context-manifest.json"), "utf8"),
  );
  for (const [file, hash] of Object.entries(
    manifest.files as Record<string, string>,
  )) {
    const current = await fs
      .readFile(path.join(root, file), "utf8")
      .catch(() => "");
    if (
      file === ".gwrk/architecture.md" &&
      crypto.createHash("sha256").update(current).digest("hex") !== hash
    ) {
      throw new CommandError(
        "Architecture context has unresolved edits. Review them before assessment.",
      );
    }
  }
  await writeIndex(root, await parseCorpus(await resolveDecisionsDir(root)));
  const references = await Promise.all(
    (options.refs ?? []).map(async (file) => ({
      file,
      content: await fs.readFile(path.resolve(root, file), "utf8"),
    })),
  );
  const prompt = [
    "Assess the entire repository against the selected architecture. Return source evidence and dependency-ordered feature specs.",
    "<selected_target>",
    target,
    "</selected_target>",
    ...references.map(
      (ref) =>
        `<prior_gap_map path=${JSON.stringify(ref.file)}>\n${ref.content}\n</prior_gap_map>`,
    ),
  ].join("\n");
  if (options.print) return { prompt };
  const output = options.output
    ? path.resolve(root, options.output)
    : path.join(
        root,
        "docs/architecture/assessments",
        new Date().toISOString().replace(/[:.]/g, "-"),
      );
  if (!output.startsWith(`${root}${path.sep}`))
    throw new CommandError("Assessment output must be inside the project.");
  try {
    await fs.access(output);
    throw new CommandError(
      "Assessment output already exists. Choose a new directory.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const { backend, model } = resolveAgent("define", root, {
    agent: options.backend,
    model: options.model,
  });
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "unavailable";
    }
  };
  const revision = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]);
  const recordedText = options.fromLog
    ? await fs.readFile(path.resolve(root, options.fromLog), "utf8")
    : undefined;
  const recordedResult =
    recordedText === undefined
      ? undefined
      : {
          ...(
            await new AgentBackendRegistry(
              new PluginLoader({ projectDir: root }),
            ).getAgentBackend(backend)
          ).parseResult(recordedText, "", 0),
          logPath: path.resolve(root, options.fromLog as string),
        };
  if (recordedResult && recordedResult.status !== "success")
    throw new CommandError(
      "Recorded output has no verified successful terminal status.",
    );
  const result = await new WorkflowRuntime().executeWorkflow(
    "gwrk-architecture-assessment",
    prompt,
    {
      projectRoot: root,
      agent: backend,
      model,
      quiet: true,
      reportOnly: true,
      recordedResult,
    },
  );
  const assessment = validateAssessment(
    (result.output as { assessment?: unknown } | undefined)?.assessment,
  );
  const sourceHashes: Record<string, string> = {};
  for (const file of new Set([
    ...assessment.inspected,
    ...assessment.findings.flatMap((finding) =>
      finding.evidence.map((evidence) => evidence.file),
    ),
  ])) {
    const full = path.resolve(root, file);
    if (!full.startsWith(`${root}${path.sep}`))
      throw new CommandError(`Evidence outside project: ${file}`);
    const content = await fs.readFile(full, "utf8");
    sourceHashes[file] = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    for (const evidence of assessment.findings
      .flatMap((finding) => finding.evidence)
      .filter((evidence) => evidence.file === file)) {
      if (evidence.line > content.split("\n").length)
        throw new CommandError(
          `Evidence line outside file: ${file}:${evidence.line}`,
        );
    }
  }
  // Require explicit treatment of every row in the supplied gap table.
  for (const ref of references) {
    const section = ref.content
      .split("## Gaps and consequences")[1]
      ?.split("\n## ")[0];
    if (!section) continue;
    const gaps = section
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .slice(1)
      .map((line) => line.split("|")[1].trim());
    for (const gap of gaps)
      if (
        !assessment.reconciliation.some(
          (entry) => entry.gap.toLowerCase() === gap.toLowerCase(),
        )
      )
        throw new CommandError(`Prior gap not reconciled: ${gap}`);
  }
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, "target.md"), target);
  await fs.writeFile(
    path.join(output, "assessment.json"),
    `${JSON.stringify(assessment, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(output, "report.md"),
    renderAssessment(assessment),
  );
  await fs.writeFile(
    path.join(output, "provenance.json"),
    `${JSON.stringify({ recoveredFrom: options.fromLog ?? null, recordedOutputHash: recordedText === undefined ? undefined : crypto.createHash("sha256").update(recordedText).digest("hex"), revision, dirtyBefore: dirty, backend, model, sourceHashes, targetHash: crypto.createHash("sha256").update(target).digest("hex"), logPath: result.logPath, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  for (const [i, ref] of references.entries())
    await fs.writeFile(path.join(output, `reference-${i + 1}.md`), ref.content);
  for (const [i, feature] of assessment.features.entries()) {
    const folder = path.join(
      output,
      "specs",
      `${String(i + 1).padStart(2, "0")}-${feature.id}`,
    );
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "spec.md"), renderFeature(feature));
  }
  return {
    output: path.relative(root, output),
    findings: assessment.findings.length,
    features: assessment.features.length,
    backend,
    summary: result.summary,
  };
}
export const createAssessCommand = () =>
  new Command("assess")
    .description(
      "Assess code against the declared architecture and propose feature specs",
    )
    .option("--output <directory>", "New project-local assessment directory")
    .option("--refs <file...>", "Prior gap maps to preserve and reconcile")
    .option("--backend <name>", "Override configured definition backend")
    .option("--model <name>", "Override configured definition model")
    .option(
      "--from-log <file>",
      "Recover a recorded agent response without another model call",
    )
    .option("--target-snapshot <file>", "Target used by a recorded response")
    .option("--print", "Print assessment input without a model call")
    .action(async (options) =>
      withSignal("assess", async () => {
        const result = await assessProject(options);
        writeScopedStdout(`${JSON.stringify(result, null, 2)}\n`);
      }),
    );

export const assessCommand = createAssessCommand();
