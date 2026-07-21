/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { extractPhases } from "./phase-extractor.js";

interface ReadinessPhase {
  number: number;
  title: string;
  sp: number;
}

export interface ReadinessResult {
  featureId: string;
  level: number;
  status: string;
  hasSpec: boolean;
  hasPlan: boolean;
  hasTasks: boolean;
  spTotal?: number;
  phases: ReadinessPhase[];
}

/**
 * Parse implementation phases from a plan.md file.
 *
 * Delegates to the shared {@link extractPhases} extractor, which recognizes
 * both `### Phase N — Title (K SP)` headings and phase-declaration list items
 * and captures story points. Kept as a thin adapter to the scanner's
 * `ReadinessPhase` shape.
 */
function parsePlanPhases(planContent: string): ReadinessPhase[] {
  return extractPhases(planContent).map((p) => ({
    number: p.seq,
    title: p.title,
    sp: p.sp,
  }));
}

/**
 * Scan the specs directory to determine readiness levels (L0–L3) for each feature.
 */
export function scanReadiness(specsDir: string): ReadinessResult[] {
  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const entries = fs.readdirSync(specsDir, { withFileTypes: true });
  const results: ReadinessResult[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "000-tdd-infrastructure")
      continue;

    const featureId = entry.name;
    const featureDir = path.join(specsDir, featureId);

    const hasSpec = fs.existsSync(path.join(featureDir, "spec.md"));
    const planPath = path.join(featureDir, "plan.md");
    const hasPlan = fs.existsSync(planPath);
    const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");
    const hasTasks = fs.existsSync(tasksPath);

    let level = 0;
    let status = "PLANNED";

    if (hasTasks && hasPlan && hasSpec) {
      level = 3;
      status = "DEFINED";
    } else if (hasPlan && hasSpec) {
      level = 2;
      status = "DEFINED";
    } else if (hasSpec) {
      level = 1;
      status = "SPECIFIED";
    } else {
      level = 0;
      status = "PLANNED";
    }

    let spTotal: number | undefined;
    if (hasTasks) {
      try {
        const tasksData = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
        if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
          spTotal = tasksData.tasks.reduce(
            (sum: number, task: { sp?: number }) => sum + (task.sp || 0),
            0,
          );
        }
      } catch (e) {
        // Ignore parse errors, spTotal remains undefined
      }
    }

    // Parse phases from plan.md
    let phases: ReadinessPhase[] = [];
    if (hasPlan) {
      try {
        const planContent = fs.readFileSync(planPath, "utf-8");
        phases = parsePlanPhases(planContent);
      } catch {
        // Non-fatal — phases stays empty
      }
    }

    results.push({
      featureId,
      level,
      status,
      hasSpec,
      hasPlan,
      hasTasks,
      spTotal,
      phases,
    });
  }

  return results;
}

