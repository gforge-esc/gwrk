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

interface TaskWithSp {
  sp?: number;
}
interface TasksPhase {
  id?: string;
  tasks?: TaskWithSp[];
}
interface TasksFile {
  phases?: TasksPhase[];
  tasks?: TaskWithSp[];
}

/**
 * Sum story points from a parsed tasks.json into a feature total and a
 * per-phase-seq map. Handles the nested `gwrk define tasks` shape
 * (`phases[].tasks[].sp`, phase id like "phase-01") and the legacy flat shape
 * (`tasks[].sp`, no phase mapping).
 */
function parseTasksSp(data: TasksFile): {
  total: number;
  bySeq: Map<number, number>;
} {
  const bySeq = new Map<number, number>();
  let total = 0;

  if (Array.isArray(data.phases)) {
    for (const phase of data.phases) {
      const seqMatch = phase.id?.match(/(\d+)/);
      const phaseSp = (phase.tasks ?? []).reduce(
        (sum, t) => sum + (t.sp ?? 0),
        0,
      );
      total += phaseSp;
      if (seqMatch) {
        const seq = Number.parseInt(seqMatch[1], 10);
        bySeq.set(seq, (bySeq.get(seq) ?? 0) + phaseSp);
      }
    }
  } else if (Array.isArray(data.tasks)) {
    total = data.tasks.reduce((sum, t) => sum + (t.sp ?? 0), 0);
  }

  return { total, bySeq };
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

    // Parse story points from tasks.json (the authoritative estimate once
    // tasks are defined). Supports both the nested `gwrk define tasks` shape
    // ({ phases: [{ id, tasks: [{ sp }] }] }) and the legacy flat shape
    // ({ tasks: [{ sp }] }).
    let spTotal: number | undefined;
    let spByPhaseSeq = new Map<number, number>();
    if (hasTasks) {
      try {
        const tasksData = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
        const parsed = parseTasksSp(tasksData);
        spTotal = parsed.total;
        spByPhaseSeq = parsed.bySeq;
      } catch (e) {
        // Ignore parse errors, spTotal remains undefined
      }
    }

    // Parse phases from plan.md, then enrich each phase's SP from tasks.json
    // (tasks.json wins when present; the plan's (K SP) is the fallback).
    let phases: ReadinessPhase[] = [];
    if (hasPlan) {
      try {
        const planContent = fs.readFileSync(planPath, "utf-8");
        phases = parsePlanPhases(planContent).map((p) => ({
          ...p,
          sp: spByPhaseSeq.get(p.number) ?? p.sp,
        }));
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

