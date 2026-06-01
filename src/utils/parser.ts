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

    // Extract phase number from header line (e.g., "6: Title" → 6)
    // This is the authoritative number, NOT the positional index in the array.
    const headerNumberMatch = headerLine.match(/^(\d+)/);
    const phaseNumber = headerNumberMatch
      ? Number.parseInt(headerNumberMatch[1], 10)
      : index + 1; // fallback to positional only if header has no number

    const phaseId = `phase-${phaseNumber.toString().padStart(2, "0")}`;
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

    // Fallback: Table-based file listings (| File | Change | format)
    // Matches rows like: | `path/to/file.ts` | [NEW] Description |
    if (tasks.length === 0) {
      const tableRows = section.matchAll(
        /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/gm,
      );
      for (const row of tableRows) {
        const filePath = row[1];
        let description = row[2].trim();
        // Strip [NEW] / [MODIFY] / [DELETE] tags for cleaner description
        const changeTag = description.match(/^\[(NEW|MODIFY|DELETE)]\s*/);
        if (changeTag) {
          description = description.replace(changeTag[0], "").trim();
        }
        if (description && !filePath.includes("---")) {
          tasks.push({
            title: `Implement ${filePath}`,
            description: description || `Implement changes for ${filePath}`,
          });
        }
      }
    }

    // Extract tests as a task: "#### Test Strategy" or "**Test Strategy:**" / "**Test Strategy**:"
    const testStrategyMatch = section.match(
      /(?:####\s+Test Strategy|^\*\*Test Strategy:?\*\*:?\s*$)/m,
    );
    if (testStrategyMatch) {
      tasks.push({
        title: `Implement test strategy for Phase ${phaseNumber}`,
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

    // Fallback: **Done When:** followed by ```bash code block
    if (doneWhen.length === 0) {
      const codeBlockMatch = section.match(
        /\*\*Done When\*\*:?\n```(?:bash|sh)?\n([\s\S]*?)```/,
      );
      if (codeBlockMatch) {
        const cmd = codeBlockMatch[1].trim();
        if (cmd) doneWhen.push(cmd);
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

/**
 * Extract the raw markdown section for a specific phase from plan.md.
 * Returns the full text between the phase header and the next phase header (or EOF).
 * Used to provide focused context to agents during phase-scoped define operations.
 *
 * @param planPath - Path to plan.md
 * @param phaseNumber - Phase number (e.g. 10). Matches "### Phase 10:" headers.
 * @returns Raw markdown string for the phase section, or null if not found.
 */
export function extractPhaseSection(
  planPath: string,
  phaseNumber: number,
): string | null {
  if (!fs.existsSync(planPath)) {
    return null;
  }

  const content = fs.readFileSync(planPath, "utf-8");

  // Match "## Phase N" or "### Phase N" with any title after
  const phasePattern = new RegExp(
    `^(#{2,3})\\s+Phase\\s+${phaseNumber}[^\\d]`,
    "m",
  );
  const match = phasePattern.exec(content);
  if (!match) {
    return null;
  }

  const startIdx = match.index;
  const headerLevel = match[1].length; // 2 or 3

  // Find the next header at the same or higher level
  const rest = content.slice(startIdx + match[0].length);
  const nextHeaderPattern = new RegExp(`^#{2,${headerLevel}}\\s+`, "m");
  const nextMatch = nextHeaderPattern.exec(rest);

  const endIdx = nextMatch
    ? startIdx + match[0].length + nextMatch.index
    : content.length;

  return content.slice(startIdx, endIdx).trim();
}

/**
 * Extract spec requirements referenced in a phase section's "Requirements Addressed" line.
 * Parses patterns like "FR-L25-003", "TC-011", "US-011", "ADR-007".
 *
 * @param phaseSection - Raw markdown from extractPhaseSection
 * @returns Array of requirement IDs (e.g. ["FR-L25-003", "TC-011", "US-011"])
 */
export function extractPhaseRequirements(phaseSection: string): string[] {
  const reqLine = phaseSection.match(
    /\*\*Requirements Addressed:\*\*\s*(.*)/,
  );
  if (!reqLine) return [];

  const ids: string[] = [];
  const pattern = /\b(FR-[\w-]+|TC-\d+|US-\d+|TR-[\w-]+|ADR-\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(reqLine[1])) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

/**
 * Extract relevant sections from spec.md that match a list of requirement IDs.
 * Returns only the spec sections that contain the referenced requirements.
 *
 * @param specPath - Path to spec.md
 * @param reqIds - Requirement IDs to match (e.g. ["FR-L25-003", "TC-011"])
 * @returns Filtered spec content, or the full spec if no IDs provided
 */
export function extractSpecSections(
  specPath: string,
  reqIds: string[],
): string {
  if (!fs.existsSync(specPath) || reqIds.length === 0) {
    return "";
  }

  const content = fs.readFileSync(specPath, "utf-8");
  const lines = content.split("\n");
  const relevant: string[] = [];
  let capturing = false;
  let headerLevel = 0;

  for (const line of lines) {
    // Check if this line contains any of our requirement IDs
    const containsReq = reqIds.some((id) => line.includes(id));

    if (containsReq) {
      capturing = true;
      // Find the section header above this line
      const headerMatch = line.match(/^(#{1,4})\s/);
      if (headerMatch) {
        headerLevel = headerMatch[1].length;
      }
      relevant.push(line);
      continue;
    }

    if (capturing) {
      const headerMatch = line.match(/^(#{1,4})\s/);
      if (headerMatch && headerMatch[1].length <= headerLevel) {
        capturing = false;
        continue;
      }
      relevant.push(line);
    }
  }

  return relevant.join("\n").trim();
}
