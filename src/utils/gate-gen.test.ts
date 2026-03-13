import { describe, expect, it } from "vitest";
import { generateGates } from "./gate-gen.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("gate-gen", () => {
  it("should generate GATE_STUB if only test -f can be derived", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-"));
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Create some-file.txt",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: ["`test -f some-file.txt`"],
      },
    ];

    generateGates(tempDir, phases);

    const gatePath = path.join(tempDir, "gates/T001-gate.sh");
    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).toContain("GATE_STUB: authored gate required");
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should generate GATE_STUB for TS file if no identifiers can be extracted", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-ts-"));
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Implement src/empty.ts",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    generateGates(tempDir, phases);

    const gatePath = path.join(tempDir, "gates/T001-gate.sh");
    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).toContain("GATE_STUB: authored gate required");
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should NOT generate GATE_STUB for .test.ts file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-testts-"));
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

    generateGates(tempDir, phases);

    const gatePath = path.join(tempDir, "gates/T001-gate.sh");
    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).not.toContain("GATE_STUB: authored gate required");
    expect(content).toContain("pnpm vitest run src/app.test.ts");
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should NOT generate GATE_STUB if test -f is combined with grep", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-comb-"));
    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Task with combined assertion",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
        doneWhen: ["`test -f file.ts && grep -q 'Foo' file.ts`"],
      },
    ];

    generateGates(tempDir, phases);

    const gatePath = path.join(tempDir, "gates/T001-gate.sh");
    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).not.toContain("GATE_STUB: authored gate required");
    expect(content).toContain("test -f file.ts && grep -q 'Foo' file.ts");
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should preserve # AUTHORED gates", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-gen-test-auth-"));
    const gatesDir = path.join(tempDir, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    
    const gatePath = path.join(gatesDir, "T001-gate.sh");
    fs.writeFileSync(gatePath, "# AUTHORED\n# My custom logic\nexit 0");

    const phases = [
      {
        id: "phase-01",
        title: "Phase 1",
        tasks: [
          {
            id: "T001",
            title: "Task 1",
            status: "open" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
    ];

    generateGates(tempDir, phases);

    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).toContain("# My custom logic");
    
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
