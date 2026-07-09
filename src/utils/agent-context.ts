/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadTaskState } from "./state.js";

/**
 * Assembles deep project context for the agent from local files and SQLite (Phase 2).
 */
export async function buildProjectContext(
  projectRoot: string,
): Promise<string> {
  const specsDir = path.join(projectRoot, "specs");
  if (!fs.existsSync(specsDir)) {
    return "No specs directory found.";
  }

  const features = fs.readdirSync(specsDir).filter((f) => {
    return fs.statSync(path.join(specsDir, f)).isDirectory();
  });

  let context = "# Project Context Summary\n\n";
  context += `Features found: ${features.length}\n\n`;

  for (const feature of features) {
    const featureDir = path.join(specsDir, feature);
    context += `## ${feature}\n`;

    // Try to load task state
    try {
      const state = loadTaskState(featureDir);
      const total = state.phases.reduce((acc, p) => acc + p.tasks.length, 0);
      const completed = state.phases.reduce(
        (acc, p) =>
          acc + p.tasks.filter((t) => t.status === "completed").length,
        0,
      );
      context += `- Progress: ${completed}/${total} tasks completed\n`;
    } catch {
      context += "- Status: Specified (no tasks.json)\n";
    }

    // Check for spec.md
    if (fs.existsSync(path.join(featureDir, "spec.md"))) {
      context += "- Spec: spec.md available\n";
    }
    if (fs.existsSync(path.join(featureDir, "plan.md"))) {
      context += "- Plan: plan.md available\n";
    }
    context += "\n";
  }

  return context;
}
