import { describe, expect, it, vi } from "vitest";
import { DriftDetector } from "./drift-detector.js";
import * as fs from "node:fs";

vi.mock("node:fs");

describe.skip("src/engine/drift-detector.ts (FR-006)", () => {
  const mockPlan = {
    features: [{ id: "F1", status: "SHIPPED", name: "Feature 1" }],
    phases: [{ id: "F1-P1", feature_id: "F1", status: "SHIPPED", name: "Phase 1" }],
    edges: []
  };

  it("should detect DRIFTED if SHIPPED phase has artifacts in .agents/", () => {
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p.includes(".agents/F1/P1")) return true;
        return false;
    });

    const detector = new DriftDetector(mockPlan as any);
    const results = detector.verify("/mock");
    const f1p1 = results.find(r => r.phaseId === "F1-P1");
    expect(f1p1?.status).toBe("DRIFTED");
  });

  it("should report CLEAN if SHIPPED phase has NO artifacts in .agents/", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const detector = new DriftDetector(mockPlan as any);
    const results = detector.verify("/mock");
    const f1p1 = results.find(r => r.phaseId === "F1-P1");
    expect(f1p1?.status).toBe("CLEAN");
  });

  it("should detect features in specs/ missing from graph", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([
        { isDirectory: () => true, name: "F1" },
        { isDirectory: () => true, name: "F2" }
    ] as any);
    const detector = new DriftDetector(mockPlan as any);
    const results = detector.verify("/mock");
    const f2 = results.find(r => r.featureId === "F2");
    expect(f2?.status).toBe("MISSING_FROM_GRAPH");
  });
});
