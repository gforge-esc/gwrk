/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Phase, Task, TaskState } from "../utils/state.js";

/**
 * Deterministic plan.md → tasks.json generator.
 *
 * Parses the structured plan format:
 *   ### Phase N: Title
 *   **Files (N):**
 *   - `path` (ACTION: description)
 *   #### Done When
 *   - gate assertion
 *
 * Emits schema-compliant TaskState. No LLM.
 */

interface ParsedPhase {
  number: number;
  title: string;
  files: { path: string; action: string; description: string }[];
  doneWhen: string[];
  testTargets: string[];
  isCompleted: boolean;
}

function parsePlanMarkdown(planContent: string): ParsedPhase[] {
  const phases: ParsedPhase[] = [];
  const lines = planContent.split("\n");

  let currentPhase: ParsedPhase | null = null;
  let section: "none" | "files" | "done_when" | "test_strategy" = "none";

  for (const line of lines) {
    // ### Phase N: Title
    const phaseMatch = line.match(
      /^###\s+Phase\s+(\d+):\s+(.+)/,
    );
    if (phaseMatch) {
      if (currentPhase) phases.push(currentPhase);
      const rawTitle = phaseMatch[2].trim();
      const isCompleted = rawTitle.includes("✅") || rawTitle.includes("[x]");
      const title = rawTitle.replace(/\s*✅/, "").replace(/\s*\[x\]/, "").trim();
      currentPhase = {
        number: Number.parseInt(phaseMatch[1], 10),
        title,
        files: [],
        doneWhen: [],
        testTargets: [],
        isCompleted,
      };
      section = "none";
      continue;
    }

    if (!currentPhase) continue;

    // **Files (N):** or #### Files — enter file section
    if (line.match(/^\*\*Files\s*(\(\d+\))?:\*\*/) || line.match(/^####\s+Files\s*$/i)) {
      section = "files";
      continue;
    }

    // Bold sub-headings within a phase that contain file lists
    // e.g., **Rules migration:** or **Missing builtin workflows (5):**
    if (section === "none" && currentPhase && line.match(/^\*\*[A-Z].*:\*\*\s*$/)) {
      section = "files";
      continue;
    }

    // #### Done When
    if (line.match(/^####\s+Done When/i)) {
      section = "done_when";
      continue;
    }

    // #### Test Strategy
    if (line.match(/^####\s+Test Strategy/i)) {
      section = "test_strategy";
      continue;
    }

    // Any other #### or ### resets section
    if (line.match(/^#{3,4}\s/)) {
      section = "none";
      continue;
    }

    // **Requirements**, **Dependencies**, **Contract**, **Governance** — skip
    if (line.match(/^\*\*(Requirements|Dependencies|Contract|Governance)/)) {
      section = "none";
      continue;
    }

    // Parse file lines: - `path` (ACTION: description)
    if (section === "files") {
      const fileMatch = line.match(
        /^-\s+`([^`]+)`\s+\((\w+):\s*(.*?)\)$/,
      );
      if (fileMatch) {
        currentPhase.files.push({
          path: fileMatch[1],
          action: fileMatch[2],
          description: fileMatch[3].trim(),
        });
        continue;
      }
      // Also match: - `path` (ACTION) without description
      const simpleMatch = line.match(/^-\s+`([^`]+)`\s+\((\w+)\)$/);
      if (simpleMatch) {
        currentPhase.files.push({
          path: simpleMatch[1],
          action: simpleMatch[2],
          description: "",
        });
        continue;
      }
      // Match: - `path` (ACTION: multi-word with special chars)
      // e.g., - `some/dir/` (DELETE: entire directory tree — 39 files)
      const extendedMatch = line.match(/^-\s+`([^`]+)`\s+\((\w+):\s*(.+)\)\s*$/);
      if (extendedMatch) {
        currentPhase.files.push({
          path: extendedMatch[1],
          action: extendedMatch[2],
          description: extendedMatch[3].trim(),
        });
        continue;
      }
    }

    // Parse done-when lines: - `command` or - text
    if (section === "done_when") {
      const doneMatch = line.match(/^-\s+(.+)/);
      if (doneMatch) {
        currentPhase.doneWhen.push(doneMatch[1].trim());
      }
    }

    // Parse test strategy table for test targets
    if (section === "test_strategy") {
      // | TR-001 | Unit | `path` | assertion |
      const trMatch = line.match(/\|\s*TR-\d+\s*\|\s*\w+\s*\|\s*`([^`]+)`/);
      if (trMatch) {
        currentPhase.testTargets.push(trMatch[1]);
      }
    }
  }

  if (currentPhase) phases.push(currentPhase);
  return phases;
}

/**
 * Generate a valid TaskState from parsed phases.
 */
function generateTaskState(
  featureId: string,
  parsed: ParsedPhase[],
  planPath: string,
  existingState?: TaskState,
): TaskState {
  let taskCounter = 1;
  const existingTasks = existingState
    ? existingState.phases.flatMap((p) => p.tasks)
    : [];
  const matchedExistingIds = new Set<string>();

  const phases: Phase[] = parsed.map((p) => {
    const phaseId = `phase-${String(p.number).padStart(2, "0")}`;
    const testFiles = p.files.filter((f) => f.path.endsWith(".test.ts"));
    const implFiles = p.files.filter((f) => !f.path.endsWith(".test.ts"));

    let tasks: Task[] = implFiles.map((f) => {
      const title = `${f.action === "NEW" ? "Create" : "Modify"} ${f.path.split("/").pop()}`;
      const relatedTest = testFiles.find((t) =>
        t.path.includes(
          f.path
            .replace(/\.ts$/, ".test.ts")
            .split("/")
            .pop()!
            .replace(".test.ts", ""),
        ),
      );

      const gateScript = relatedTest
        ? `pnpm vitest run ${relatedTest.path}`
        : `test -f ${f.path}`;

      const existing = existingTasks.find(
        (et) => et.title === title && !matchedExistingIds.has(et.id),
      );
      if (existing) matchedExistingIds.add(existing.id);

      return {
        id: "", // Assigned later to ensure sequentiality
        title,
        description: `${f.action} ${f.path}. ${f.description}${relatedTest ? `. Tests: ${relatedTest.path}` : ""}`,
        status: (existing?.status || (p.isCompleted ? "completed" : "open")) as Task["status"],
        gateScript,
        sp: f.action === "NEW" ? 2 : 1,
        completedAt: existing?.completedAt || (p.isCompleted && !existing?.status ? new Date().toISOString() : undefined),
      };
    });

    // If no impl files were found, create tasks from the raw file list
    if (tasks.length === 0) {
      for (const f of p.files) {
        const title = `${f.action === "NEW" ? "Create" : "Update"} ${f.path.split("/").pop()}`;
        const existing = existingTasks.find(
          (et) => et.title === title && !matchedExistingIds.has(et.id),
        );
        if (existing) matchedExistingIds.add(existing.id);

        tasks.push({
          id: "",
          title,
          description: `${f.action} ${f.path}. ${f.description}`,
          status: (existing?.status || (p.isCompleted ? "completed" : "open")) as Task["status"],
          gateScript: `test -f ${f.path}`,
          sp: 1,
          completedAt: existing?.completedAt || (p.isCompleted && !existing?.status ? new Date().toISOString() : undefined),
        });
      }
    }

    // Last resort: synthesize one from the phase title
    if (tasks.length === 0) {
      const title = p.title;
      const existing = existingTasks.find(
        (et) => et.title === title && !matchedExistingIds.has(et.id),
      );
      if (existing) matchedExistingIds.add(existing.id);

      const gate =
        p.doneWhen.length > 0
          ? p.doneWhen[0]
          : `echo "Phase ${p.number}: ${p.title}"`;
      tasks.push({
        id: "",
        title,
        description: `Complete phase ${p.number}: ${p.title}`,
        status: (existing?.status || (p.isCompleted ? "completed" : "open")) as Task["status"],
        gateScript: gate,
        sp: 2,
        completedAt: existing?.completedAt || (p.isCompleted && !existing?.status ? new Date().toISOString() : undefined),
      });
    }

    // Reconciliation: Find tasks that were in this phase in existingState but are now gone
    if (existingState) {
      const existingPhase = existingState.phases.find((ep) => ep.id === phaseId);
      if (existingPhase) {
        const removedTasks = existingPhase.tasks.filter(
          (et) => !matchedExistingIds.has(et.id),
        );
        for (const rt of removedTasks) {
          matchedExistingIds.add(rt.id);
          tasks.push({
            ...rt,
            id: "", // Reassigned later
            status: "cancelled",
          });
        }
      }
    }

    // Assign sequential IDs
    tasks = tasks.map((t) => ({
      ...t,
      id: `T${String(taskCounter++).padStart(3, "0")}`,
    }));

    const spEstimate = tasks.reduce((sum, t) => sum + t.sp, 0);

    return {
      id: phaseId,
      title: p.title,
      tasks,
      sp_estimate: spEstimate,
      doneWhen: p.doneWhen.length > 0 ? p.doneWhen : undefined,
    };
  });

  // Reconciliation: Catch any remaining matchedExistingIds that weren't in any matched phase
  // (e.g. if a phase was entirely removed)
  if (existingState) {
    const orphanTasks = existingTasks.filter(
      (et) => !matchedExistingIds.has(et.id),
    );
    if (orphanTasks.length > 0 && phases.length > 0) {
      const lastPhase = phases[phases.length - 1];
      for (const ot of orphanTasks) {
        lastPhase.tasks.push({
          ...ot,
          id: `T${String(taskCounter++).padStart(3, "0")}`,
          status: "cancelled",
        });
      }
    }
  }

  // Provenance: hash of plan.md
  let generatedFrom: { plan: { hash: string; modifiedAt: string } } | undefined;
  try {
    const content = fs.readFileSync(planPath, "utf-8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const stat = fs.statSync(planPath);
    generatedFrom = {
      plan: {
        hash,
        modifiedAt: stat.mtime.toISOString(),
      },
    };
  } catch {
    // Non-fatal
  }

  return {
    featureId,
    createdAt: new Date().toISOString(),
    generatedFrom,
    phases,
  };
}

/**
 * Full pipeline: read plan.md, parse, generate tasks.json, write.
 */
export function planToTasks(
  featureDir: string,
  featureId: string,
  options: { reconcile?: boolean } = {},
): TaskState {
  const planPath = path.join(featureDir, "plan.md");
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan not found at ${planPath}`);
  }

  let existingState: TaskState | undefined;
  if (options.reconcile) {
    const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");
    if (fs.existsSync(tasksPath)) {
      try {
        const content = fs.readFileSync(tasksPath, "utf-8");
        existingState = JSON.parse(content) as TaskState;
      } catch (err) {
        console.warn(`Warning: Could not load existing tasks for reconciliation: ${err}`);
      }
    }
  }

  const planContent = fs.readFileSync(planPath, "utf-8");
  const parsed = parsePlanMarkdown(planContent);

  if (parsed.length === 0) {
    throw new Error(
      `No phases found in ${planPath}. Expected '### Phase N: Title' headings.`,
    );
  }

  const state = generateTaskState(featureId, parsed, planPath, existingState);

  // Write via saveTaskState for Zod validation
  const gwrkDir = path.join(featureDir, ".gwrk");
  if (!fs.existsSync(gwrkDir)) {
    fs.mkdirSync(gwrkDir, { recursive: true });
  }

  const tasksPath = path.join(gwrkDir, "tasks.json");
  const tempPath = `${tasksPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tempPath, tasksPath);

  return state;
}
