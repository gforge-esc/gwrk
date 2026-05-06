import { describe, expect, it, vi, beforeEach } from "vitest";
import { DriftDetector } from "./drift-detector.js";
import * as fs from "node:fs";

vi.mock("node:fs");

describe("src/engine/drift-detector.ts (FR-006)", () => {
  const mockPlan = {
    features: [
      { id: "F1", status: "SHIPPED", name: "Feature 1", sp_total: 5 },
      { id: "F2", status: "PLANNED", name: "Feature 2", sp_total: 3 },
    ],
    phases: [
      {
        id: "F1-P1",
        feature_id: "F1",
        status: "SHIPPED",
        name: "Phase 1",
        health: "GREEN",
        sp_estimate: 5,
        seq: 1,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should detect DRIFTED if SHIPPED phase has .agents/ artifacts", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.includes(".agents")) return true;
      if (ps.includes("specs")) return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as fs.Dirent[]);

    const detector = new DriftDetector(mockPlan);
    const results = detector.verify("/mock");
    const drifted = results.find(
      (r) => r.phaseId === "F1-P1" && r.status === "DRIFTED",
    );
    expect(drifted).toBeDefined();
    expect(drifted?.reason).toContain(".agents/");
  });

  it("should report CLEAN if SHIPPED phase has NO .agents/ artifacts", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.includes(".agents")) return false;
      if (ps.includes("specs")) return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as fs.Dirent[]);

    const detector = new DriftDetector(mockPlan);
    const results = detector.verify("/mock");
    const clean = results.find(
      (r) => r.phaseId === "F1-P1" && r.status === "CLEAN",
    );
    expect(clean).toBeDefined();
  });

  it("should detect features in specs/ missing from graph", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.endsWith("specs")) return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { isDirectory: () => true, name: "F1" },
      { isDirectory: () => true, name: "F999-unknown" },
    ] as unknown as fs.Dirent[]);

    const detector = new DriftDetector(mockPlan);
    const results = detector.verify("/mock");
    const missing = results.find(
      (r) =>
        r.featureId === "F999-unknown" && r.status === "MISSING_FROM_GRAPH",
    );
    expect(missing).toBeDefined();
    expect(missing?.reason).toContain("not in the build plan graph");
  });

  it("should detect tasks.json status mismatch with graph", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      const ps = String(p);
      if (ps.includes("tasks.json")) return true;
      if (ps.endsWith("specs")) return true;
      return false;
    });
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as fs.Dirent[]);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        phases: [
          {
            id: "F1-P1",
            tasks: [{ id: "T001", status: "open" }],
          },
        ],
      }),
    );

    const detector = new DriftDetector(mockPlan);
    const results = detector.verify("/mock");
    const mismatch = results.find(
      (r) =>
        r.phaseId === "F1-P1" &&
        r.status === "DRIFTED" &&
        r.reason?.includes("open tasks"),
    );
    expect(mismatch).toBeDefined();
  });
});
