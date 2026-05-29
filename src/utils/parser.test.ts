import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parsePlan } from "./parser.js";

describe("parsePlan (parser.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "parser-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(content: string): string {
    const planPath = path.join(tempDir, "plan.md");
    fs.writeFileSync(planPath, content);
    return planPath;
  }

  it("should parse gwrk-native **Files (N):** bullet format", () => {
    const planPath = writePlan(`# Plan: test-feature

## Phase 1: Core
**Files (2):**
- \`src/commands/foo.ts\` (Command handler)
- \`src/utils/bar.ts\` (Utility module)

#### Test Strategy
Test all the things

#### Done When
- \`test -f src/commands/foo.ts\`
`);

    const result = parsePlan(planPath);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].tasks).toHaveLength(3); // 2 files + 1 test strategy
    expect(result.phases[0].tasks[0].title).toBe("Implement src/commands/foo.ts");
    expect(result.phases[0].tasks[0].description).toBe("Command handler");
    expect(result.phases[0].tasks[1].title).toBe("Implement src/utils/bar.ts");
    expect(result.phases[0].tasks[2].title).toContain("test strategy");
    expect(result.phases[0].doneWhen).toEqual(["`test -f src/commands/foo.ts`"]);
  });

  it("should parse table-based | File | Change | format", () => {
    const planPath = writePlan(`# Plan: 048-typology-wireframes

## Phase 1: Core Survey Workflow (W1, W2, W3)

Implement the primary screens.

| File | Change |
|------|--------|
| \`specs/048/screens/wireframe.css\` | [NEW] Base styles (Reset, Grid layout) |
| \`specs/048/screens/W1.html\` | [NEW] Survey Home implementation |
| \`specs/048/screens/W2.html\` | [NEW] Question Browser implementation |
| \`specs/048/screens/W3.html\` | [NEW] Guidance Review implementation |

**Test Strategy:**
| ID | Type | Target | Assertion |
|----|------|--------|-----------|
| TR-001a | Verifier | W1.html | test -f |

**Done When**:
\`\`\`bash
test -f screens/W1.html && test -f screens/W2.html
\`\`\`
`);

    const result = parsePlan(planPath);
    expect(result.phases).toHaveLength(1);

    const phase = result.phases[0];
    // 4 file tasks + 1 test strategy task
    expect(phase.tasks.length).toBeGreaterThanOrEqual(4);
    expect(phase.tasks[0].title).toBe("Implement specs/048/screens/wireframe.css");
    expect(phase.tasks[0].description).toBe("Base styles (Reset, Grid layout)");
    expect(phase.tasks[1].title).toBe("Implement specs/048/screens/W1.html");
    expect(phase.tasks[1].description).toBe("Survey Home implementation");

    // Test strategy task
    const testTask = phase.tasks.find(t => t.title.includes("test strategy"));
    expect(testTask).toBeDefined();

    // Done When from code block
    expect(phase.doneWhen).toHaveLength(1);
    expect(phase.doneWhen[0]).toContain("test -f screens/W1.html");
  });

  it("should parse multiple phases with table format", () => {
    const planPath = writePlan(`# Plan

## Phase 1: Core Workflow

| File | Change |
|------|--------|
| \`screens/W1.html\` | [NEW] Dashboard |
| \`screens/W2.html\` | [NEW] Browser |

## Phase 2: Admin Workflow

| File | Change |
|------|--------|
| \`screens/W4.html\` | [NEW] Editor |

## Phase 3: Navigation

| File | Change |
|------|--------|
| \`screens/nav.html\` | [MODIFY] Add relative href links |
`);

    const result = parsePlan(planPath);
    expect(result.phases).toHaveLength(3);
    expect(result.phases[0].tasks).toHaveLength(2);
    expect(result.phases[1].tasks).toHaveLength(1);
    expect(result.phases[2].tasks).toHaveLength(1);
    expect(result.phases[2].tasks[0].description).toBe("Add relative href links");
  });

  it("should strip [NEW]/[MODIFY]/[DELETE] tags from descriptions", () => {
    const planPath = writePlan(`# Plan

## Phase 1: Setup

| File | Change |
|------|--------|
| \`src/new.ts\` | [NEW] New module |
| \`src/update.ts\` | [MODIFY] Update existing |
| \`src/old.ts\` | [DELETE] Remove legacy |
`);

    const result = parsePlan(planPath);
    expect(result.phases[0].tasks[0].description).toBe("New module");
    expect(result.phases[0].tasks[1].description).toBe("Update existing");
    expect(result.phases[0].tasks[2].description).toBe("Remove legacy");
  });

  it("should prefer **Files (N):** format over table when both present", () => {
    const planPath = writePlan(`# Plan

## Phase 1: Core
**Files (1):**
- \`foo.ts\` (The real one)

| File | Change |
|------|--------|
| \`bar.ts\` | [NEW] Should be ignored |
`);

    const result = parsePlan(planPath);
    // The **Files** format wins, table is only a fallback
    expect(result.phases[0].tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.phases[0].tasks[0].title).toBe("Implement foo.ts");
  });

  it("should extract Done When from code blocks", () => {
    const planPath = writePlan(`# Plan

## Phase 1: Core

| File | Change |
|------|--------|
| \`main.ts\` | [NEW] Entry point |

**Done When**:
\`\`\`bash
test -f main.ts && node main.ts
\`\`\`
`);

    const result = parsePlan(planPath);
    expect(result.phases[0].doneWhen).toHaveLength(1);
    expect(result.phases[0].doneWhen[0]).toContain("test -f main.ts");
  });
});
