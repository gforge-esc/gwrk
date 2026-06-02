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
}

export function parsePlanMarkdown(planContent: string): ParsedPhase[] {
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
      currentPhase = {
        number: Number.parseInt(phaseMatch[1], 10),
        title: phaseMatch[2].trim(),
        files: [],
        doneWhen: [],
        testTargets: [],
      };
      section = "none";
      continue;
    }

    if (!currentPhase) continue;

    // **Files (N):**
    if (line.match(/^\*\*Files\s*\(\d+\):\*\*/)) {
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

    // **Requirements**, **Dependencies**, **Contract** — skip
    if (line.match(/^\*\*(Requirements|Dependencies|Contract)/)) {
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
export function generateTaskState(
  featureId: string,
  parsed: ParsedPhase[],
  planPath: string,
): TaskState {
  let taskCounter = 1;

  const phases: Phase[] = parsed.map((p) => {
    const phaseId = `phase-${String(p.number).padStart(2, "0")}`;
    const testFiles = p.files.filter((f) => f.path.endsWith(".test.ts"));
    const implFiles = p.files.filter((f) => !f.path.endsWith(".test.ts"));

    const tasks: Task[] = implFiles.map((f) => {
      const id = `T${String(taskCounter++).padStart(3, "0")}`;
      const relatedTest = testFiles.find((t) =>
        t.path.includes(f.path.replace(/\.ts$/, ".test.ts").split("/").pop()!.replace(".test.ts", "")),
      );

      const gateScript = relatedTest
        ? `pnpm vitest run ${relatedTest.path}`
        : `test -f ${f.path}`;

      return {
        id,
        title: `${f.action === "NEW" ? "Create" : "Modify"} ${f.path.split("/").pop()}`,
        description: `${f.action} ${f.path}. ${f.description}${relatedTest ? `. Tests: ${relatedTest.path}` : ""}`,
        status: "open" as const,
        gateScript,
        sp: f.action === "NEW" ? 2 : 1,
      };
    });

    // If no impl files were found, create tasks from the raw file list
    if (tasks.length === 0) {
      for (const f of p.files) {
        const id = `T${String(taskCounter++).padStart(3, "0")}`;
        tasks.push({
          id,
          title: `${f.action === "NEW" ? "Create" : "Update"} ${f.path.split("/").pop()}`,
          description: `${f.action} ${f.path}. ${f.description}`,
          status: "open" as const,
          gateScript: `test -f ${f.path}`,
          sp: 1,
        });
      }
    }

    const spEstimate = tasks.reduce((sum, t) => sum + t.sp, 0);

    return {
      id: phaseId,
      title: p.title,
      tasks,
      sp_estimate: spEstimate,
      doneWhen: p.doneWhen.length > 0 ? p.doneWhen : undefined,
    };
  });

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
export function planToTasks(featureDir: string, featureId: string): TaskState {
  const planPath = path.join(featureDir, "plan.md");
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan not found at ${planPath}`);
  }

  const planContent = fs.readFileSync(planPath, "utf-8");
  const parsed = parsePlanMarkdown(planContent);

  if (parsed.length === 0) {
    throw new Error(
      `No phases found in ${planPath}. Expected '### Phase N: Title' headings.`,
    );
  }

  const state = generateTaskState(featureId, parsed, planPath);

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
