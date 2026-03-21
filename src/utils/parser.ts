import fs from "node:fs";

export interface ParsedTask {
  title: string;
  description: string;
}

export interface ParsedPhase {
  id: string;
  title: string;
  tasks: ParsedTask[];
  doneWhen: string[];
  sp?: number;
}

export function parsePlan(planPath: string): { phases: ParsedPhase[] } {
  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found at ${planPath}`);
  }

  const content = fs.readFileSync(planPath, "utf-8");
  const phases: ParsedPhase[] = [];

  // Split by phase headers: "## Phase N" or "### Phase N"
  const phaseSections = content.split(/^#{2,3}\s+Phase\s+/m).slice(1);

  for (let index = 0; index < phaseSections.length; index++) {
    const section = phaseSections[index];
    const lines = section.split("\n");
    const headerLine = lines[0];

    // Header format examples:
    // 1: Title (7 SP)
    // 1 — Title (7 SP)
    // 1 — Title
    
    // Extract Title
    let title = headerLine.replace(/^\d+[:\s—-]*/, "").trim();
    
    // Extract SP
    let sp: number | undefined;
    const spMatch = headerLine.match(/\((\d+(?:\.\d+)?)\s*SP\)/i);
    if (spMatch) {
      sp = Number.parseFloat(spMatch[1]);
      // Remove SP from title if it was there
      title = title.replace(spMatch[0], "").trim();
    }

    const phaseId = `phase-${(index + 1).toString().padStart(2, "0")}`;
    const tasks: ParsedTask[] = [];

    // Extract files as tasks: "**Files (N):**" followed by bullet points
    const filesMatch = section.match(/\*\*Files \(\d+\):\*\*\n((?:- .*\n?)+)/);
    if (filesMatch) {
      const fileLines = filesMatch[1].trim().split("\n");
      for (const line of fileLines) {
        // Format: - `file.ts` (Description)
        const match = line.match(/- `(.*?)` \((.*?)\)/);
        if (match) {
          tasks.push({
            title: `Implement ${match[1]}`,
            description: match[2],
          });
        } else {
          const matchSimple = line.match(/- `(.*?)`/);
          if (matchSimple) {
            tasks.push({
              title: `Implement ${matchSimple[1]}`,
              description: `Implement changes for ${matchSimple[1]}`,
            });
          }
        }
      }
    }

    // Extract tests as a task: "#### Test Strategy"
    const testStrategyMatch = section.match(
      /#### Test Strategy\n([\s\S]*?)(?:\n####|$)/,
    );
    if (testStrategyMatch) {
      tasks.push({
        title: `Implement test strategy for Phase ${index + 1}`,
        description:
          "Implement all unit and integration tests defined in the phase test strategy.",
      });
    }

    // Extract Done When assertions
    const doneWhen: string[] = [];
    const doneWhenMatch = section.match(/#### Done When\n((?:- .*\n?)+)/);
    if (doneWhenMatch) {
      const lines = doneWhenMatch[1].trim().split("\n");
      for (const line of lines) {
        const m = line.match(/- (.*)/);
        if (m) doneWhen.push(m[1].trim());
      }
    }

    phases.push({
      id: phaseId,
      title,
      tasks,
      doneWhen,
      sp,
    });
  }

  return { phases };
}
