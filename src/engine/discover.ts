import fs from "node:fs";
import path from "node:path";
import { type GwrkConfig, GwrkConfigSchema } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";
import { TaskStateSchema } from "../utils/state.js";

export interface GitState {
  branch: string;
  clean: boolean;
  lastCommit: string;
}

export interface SpecSummary {
  id: string;
  name: string;
  dirPath: string;
  status: "drafted" | "planned" | "tasked" | "shipped";
  hasPlan: boolean;
  hasTasks: boolean;
  phases: number;
  tasksOpen: number;
  tasksComplete: number;
}

export interface ProjectDiscovery {
  project: {
    name: string;
    root: string;
    git: GitState;
  };
  specs: SpecSummary[];
  gates: {
    total: number;
    passing: number;
    failing: number;
  };
  config: {
    hasSlack: boolean;
    hasServer: boolean;
    agents: string[];
  };
}

/**
 * Assembles project state from repository contents.
 * Implements FR-004, FR-005.
 */
export async function discoverProject(
  projectRoot: string,
): Promise<ProjectDiscovery> {
  const git = await getGitState(projectRoot);
  const config = loadRawConfig(projectRoot);
  const specs = await discoverSpecs(projectRoot);
  const gates = await discoverGates(projectRoot, specs);

  const projectName = config?.project?.name || path.basename(projectRoot);

  return {
    project: {
      name: projectName,
      root: projectRoot,
      git,
    },
    specs,
    gates,
    config: {
      hasSlack: !!config?.project?.slack,
      hasServer: !!config?.server,
      agents: await detectAgents(),
    },
  };
}

async function getGitState(cwd: string): Promise<GitState> {
  const [branchRes, statusRes, logRes] = await Promise.all([
    execCommand("git", ["branch", "--show-current"], undefined, { cwd }),
    execCommand("git", ["status", "--porcelain"], undefined, { cwd }),
    execCommand("git", ["log", "-1", "--format=%h %s"], undefined, { cwd }),
  ]);

  return {
    branch: branchRes.stdout.trim() || "unknown",
    clean: statusRes.stdout.trim() === "",
    lastCommit: logRes.stdout.trim() || "none",
  };
}

function loadRawConfig(projectRoot: string): GwrkConfig | null {
  const configPath = path.join(projectRoot, ".gwrkrc.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const result = GwrkConfigSchema.safeParse(raw);
    return result.success ? (result.data as GwrkConfig) : null;
  } catch {
    return null;
  }
}

async function discoverSpecs(projectRoot: string): Promise<SpecSummary[]> {
  const specsDir = path.join(projectRoot, "specs");
  if (!fs.existsSync(specsDir)) return [];

  const specDirs = fs.readdirSync(specsDir).filter((d) => {
    return fs.statSync(path.join(specsDir, d)).isDirectory();
  });

  const summaries: SpecSummary[] = [];

  for (const dirName of specDirs) {
    const dirPath = path.join("specs", dirName);
    const absolutePath = path.join(projectRoot, dirPath);

    const hasSpec = fs.existsSync(path.join(absolutePath, "spec.md"));
    const hasPlan = fs.existsSync(path.join(absolutePath, "plan.md"));
    const tasksPath = path.join(absolutePath, ".gwrk", "tasks.json");
    const hasTasks = fs.existsSync(tasksPath);

    let phases = 0;
    let tasksOpen = 0;
    let tasksComplete = 0;
    let status: SpecSummary["status"] = "drafted";

    if (hasTasks) {
      try {
        const raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
        const taskState = TaskStateSchema.safeParse(raw);
        if (taskState.success) {
          phases = taskState.data.phases.length;
          const allTasks = taskState.data.phases.flatMap((p) => p.tasks);
          tasksOpen = allTasks.filter(
            (t) => t.status === "open" || t.status === "in_progress",
          ).length;
          tasksComplete = allTasks.filter(
            (t) => t.status === "completed",
          ).length;

          if (tasksComplete > 0 && tasksOpen === 0) {
            status = "shipped";
          } else if (tasksComplete > 0 || tasksOpen > 0) {
            status = "tasked";
          } else {
            status = "planned";
          }
        }
      } catch {
        // Ignore parse errors for discovery
      }
    } else if (hasPlan) {
      status = "planned";
    }

    // Attempt to extract name from spec.id if possible, or use dirName
    // Many dirNames are like "001-cli-core"
    const nameMatch = dirName.match(/^\d+-(.+)$/);
    const name = nameMatch ? nameMatch[1] : dirName;
    const id = dirName.split("-")[0];

    summaries.push({
      id,
      name,
      dirPath,
      status,
      hasPlan,
      hasTasks,
      phases,
      tasksOpen,
      tasksComplete,
    });
  }

  return summaries;
}

async function discoverGates(
  projectRoot: string,
  specs: SpecSummary[],
): Promise<{ total: number; passing: number; failing: number }> {
  let total = 0;

  // Count gate files across all specs — don't execute during discovery
  // (execution of 100+ gates would hang; use `gwrk gate <feature>` instead)
  for (const spec of specs) {
    const gatesDir = path.join(projectRoot, spec.dirPath, "gates");
    if (!fs.existsSync(gatesDir)) continue;

    const gateFiles = fs
      .readdirSync(gatesDir)
      .filter((f) => f.endsWith("-gate.sh"));
    total += gateFiles.length;
  }

  // passing/failing are only available via `gwrk gate <feature>`
  return { total, passing: -1, failing: -1 };
}

async function detectAgents(): Promise<string[]> {
  const agents = ["gemini", "claude", "codex"];
  const detected: string[] = [];

  await Promise.all(
    agents.map(async (agent) => {
      const res = await execCommand("which", [agent]);
      if (res.exitCode === 0) {
        detected.push(agent);
      }
    }),
  );

  return detected;
}
