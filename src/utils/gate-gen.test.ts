import { describe, expect, it } from "vitest";
import { generateGateBrief } from "./gate-gen.js";
import type { GateBrief } from "./gate-gen.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("gate-gen", () => {
  function makeTempFeature(
    opts: {
      contracts?: Record<string, string>;
    } = {},
  ): string {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-"));
    if (opts.contracts) {
      const contractsDir = path.join(tempDir, "contracts");
      fs.mkdirSync(contractsDir, { recursive: true });
      for (const [name, content] of Object.entries(opts.contracts)) {
        fs.writeFileSync(path.join(contractsDir, name), content);
      }
    }
    return tempDir;
  }

  it("should produce valid GateBrief JSON", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Create src/utils/signal.ts",
            description: "Implement withSignal() wrapper",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: ["`pnpm build`"],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.feature).toBe("test-feature");
    expect(brief.projectType).toBe("gwrk-typescript");
    expect(brief.tasks).toHaveLength(1);
    expect(brief.tasks[0].taskId).toBe("T001");
    expect(brief.tasks[0].primaryFile).toBe("src/utils/signal.ts");
    expect(brief.tasks[0].fileType).toBe("typescript");

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(briefPath);
  });

  it("should classify .test.ts files as test type", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Write src/app.test.ts",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].fileType).toBe("test");
    expect(brief.tasks[0].primaryFile).toBe("src/app.test.ts");

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(briefPath);
  });

  it("should extract identifiers from descriptions", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement src/utils/signal.ts",
            description:
              "Add `withSignal` function and `CommandError` class. Must export `formatDuration` helper.",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].identifiers).toContain("withSignal");
    expect(brief.tasks[0].identifiers).toContain("CommandError");
    expect(brief.tasks[0].identifiers).toContain("formatDuration");

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(briefPath);
  });

  it("should match contract refs when contracts exist", () => {
    const tempDir = makeTempFeature({
      contracts: {
        "signal.md": "# Contract: Signal\n\nwithSignal() wrapper.",
        "output.md": "# Contract: Output\n\nCommandOutput interface.",
      },
    });
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement signal wrapper",
            description: "Per signal contract, add withSignal()",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].contractRefs).toContain("contracts/signal.md");

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(briefPath);
  });

  it("should include doneWhen commands relevant to the task file", () => {
    const tempDir = makeTempFeature();
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement src/utils/signal.ts",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: [
          "`grep -q 'withSignal' src/utils/signal.ts`",
          "`pnpm build`",
        ],
      },
    ];

    const briefPath = generateGateBrief(tempDir, phases, "test-feature");
    const brief: GateBrief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

    expect(brief.tasks[0].doneWhenCommands).toContain(
      "grep -q 'withSignal' src/utils/signal.ts",
    );
    // pnpm build doesn't reference signal.ts by name so it shouldn't match
    expect(brief.tasks[0].doneWhenCommands).not.toContain("pnpm build");

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(briefPath);
  });
});
