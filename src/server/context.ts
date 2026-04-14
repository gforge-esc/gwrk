import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Reads all .md files from a directory, if it exists.
 */
function readMarkdownDir(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  let content = "";
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const file of files) {
    content += `### ${file}\n\n`;
    content += fs.readFileSync(path.join(dir, file), "utf-8");
    content += "\n\n";
  }
  return content;
}

export function compileContext(
  projectRoot: string,
  featureId: string,
  phaseId: string,
): string {
  const gwrkGlobal = path.join(os.homedir(), ".gwrk");
  const gwrkLocal = path.join(projectRoot, ".gwrk");

  let context = "# gwrk Phase Context\n\n";

  // 1. Governance Rules — .gwrk/rules/ (project) then ~/.gwrk/rules/ (global)
  context += "## Governance Rules\n\n";
  context += readMarkdownDir(path.join(gwrkLocal, "rules"));
  context += readMarkdownDir(path.join(gwrkGlobal, "rules"));

  // 2. Persona — .gwrk/personas/ (project) then ~/.gwrk/personas/ (global)
  context += "## Persona\n\n";
  context += readMarkdownDir(path.join(gwrkLocal, "personas"));
  context += readMarkdownDir(path.join(gwrkGlobal, "personas"));

  // 3. Spec & Plan
  const specPath = path.join(projectRoot, `specs/${featureId}/spec.md`);
  const planPath = path.join(projectRoot, `specs/${featureId}/plan.md`);

  if (fs.existsSync(specPath)) {
    context += "## Feature Specification\n\n";
    context += fs.readFileSync(specPath, "utf-8");
    context += "\n\n";
  }

  if (fs.existsSync(planPath)) {
    context += "## Implementation Plan\n\n";
    context += fs.readFileSync(planPath, "utf-8");
    context += "\n\n";
  }

  // 4. Tasks
  const tasksPath = path.join(
    projectRoot,
    `specs/${featureId}/.gwrk/tasks.json`,
  );
  if (fs.existsSync(tasksPath)) {
    context += "## Tasks\n\n";
    try {
      const raw = fs.readFileSync(tasksPath, "utf-8");
      context += "```json\n";
      context += raw;
      context += "\n```\n\n";
    } catch (e) {
      context += "Error reading tasks.json\n\n";
    }
  }

  return context;
}

