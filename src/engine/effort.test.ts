import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { computeEffort } from "./effort.js";
import { writeEffortReport } from "./report-writer.js";
import { resolveRoleMultipliers } from "./roles.js";
import { extractStories } from "./spec-parser.js";
import type {
  EffortReport,
  RoleBreakdown,
  RoleConfig,
  StoryEstimate,
} from "./types.js";

/**
 * RED tests for src/engine/effort.ts + roles.ts + report-writer.ts
 * Contracts: contracts/effort-engine.md
 * FR-002: Compute hours with role multipliers + 1.25× overhead
 * FR-003: Generate markdown effort report to docs/assessments/
 * FR-012: Role multiplier overrides from .gwrkrc.json
 */

describe("FR-001: extractStories — parsing markdown spec", () => {
  it("TR-001: extracts stories with SP and role brackets", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "### US-001 - Some story [5 SP, TS, PE]\n### US-002 - Another story [2 SP, RE]",
    );

    const stories = extractStories("/tmp/fake");
    expect(stories).toHaveLength(2);
    expect(stories[0]?.storyId).toBe("US-001");
    expect(stories[0]?.sp).toBe(5);
    expect(stories[0]?.roles).toEqual(["TS", "PE"]);

    expect(stories[1]?.storyId).toBe("US-002");
    expect(stories[1]?.sp).toBe(2);
    expect(stories[1]?.roles).toEqual(["RE"]);

    vi.restoreAllMocks();
  });

  it("TR-001: handles unestimated stories", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "### US-003 - Unestimated story",
    );

    const stories = extractStories("/tmp/fake");
    expect(stories[0]?.sp).toBe(0);
    expect(stories[0]?.roles).toEqual([]);

    vi.restoreAllMocks();
  });

  it("TR-004: throws when spec.md is missing", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    expect(() => extractStories("/tmp/missing")).toThrow(/spec\.md not found/);

    vi.restoreAllMocks();
  });

  it("TR-004: throws when no stories are found", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(
      "# Just a spec\nNo stories here.",
    );

    expect(() => extractStories("/tmp/empty")).toThrow(/No user stories found/);

    vi.restoreAllMocks();
  });
});

describe("FR-002: computeEffort — role-bracketed hour computation", () => {
  const defaultRoles: RoleConfig[] = [
    { role: "RE", roleName: "Rust / Engine Engineer", hoursPerSP: 6 },
    { role: "TS", roleName: "TS / Fullstack Developer", hoursPerSP: 4 },
    { role: "PM", roleName: "Product Manager", hoursPerSP: 2 },
    { role: "PE", roleName: "Principal Engineer", hoursPerSP: 1.5 },
    { role: "DE", roleName: "Data / Generator Engineer", hoursPerSP: 5 },
  ];

  // TR-002: 5 SP × TS(4h) = 20h raw, 25h with 1.25× overhead
  it("TR-002: computes 5 SP × TS(4h/SP) = 20h raw, 25h with 1.25× overhead", () => {
    const stories: StoryEstimate[] = [
      {
        storyId: "US-001",
        title: "Test story",
        sp: 5,
        roles: ["TS"],
        rawHours: 0,
        withOverhead: 0,
      },
    ];
    const report = computeEffort(stories, defaultRoles, 1.25);

    expect(report.totalRawHours).toBe(20);
    expect(report.totalWithOverhead).toBe(25);
  });

  it("computes multi-role stories with independent hour calculations", () => {
    const stories: StoryEstimate[] = [
      {
        storyId: "US-001",
        title: "Multi-role story",
        sp: 5,
        roles: ["RE", "TS"],
        rawHours: 0,
        withOverhead: 0,
      },
    ];
    const report = computeEffort(stories, defaultRoles, 1.25);

    // RE: 5 × 6 = 30, TS: 5 × 4 = 20 → 50 raw, 62.5 with overhead
    expect(report.totalRawHours).toBe(50);
    expect(report.totalWithOverhead).toBe(62.5);
  });

  it("returns EffortReport with correct structure", () => {
    const stories: StoryEstimate[] = [
      {
        storyId: "US-001",
        title: "Test",
        sp: 3,
        roles: ["TS"],
        rawHours: 0,
        withOverhead: 0,
      },
    ];
    const report = computeEffort(stories, defaultRoles, 1.25);

    expect(report.featureId).toBeTruthy();
    expect(report.totalSP).toBe(3);
    expect(report.overheadFactor).toBe(1.25);
    expect(report.roles).toBeInstanceOf(Array);
    expect(report.stories).toBeInstanceOf(Array);
    expect(report.totalDays).toBe(report.totalWithOverhead / 8);
  });

  it("aggregates role breakdowns across multiple stories", () => {
    const stories: StoryEstimate[] = [
      {
        storyId: "US-001",
        title: "A",
        sp: 3,
        roles: ["TS"],
        rawHours: 0,
        withOverhead: 0,
      },
      {
        storyId: "US-002",
        title: "B",
        sp: 5,
        roles: ["TS"],
        rawHours: 0,
        withOverhead: 0,
      },
    ];
    const report = computeEffort(stories, defaultRoles, 1.25);

    const tsBreakdown = report.roles.find(
      (r: RoleBreakdown) => r.role === "TS",
    );
    expect(tsBreakdown).toBeDefined();
    expect(tsBreakdown?.spAssigned).toBe(8);
    expect(tsBreakdown?.rawHours).toBe(32); // 8 × 4
  });

  it("handles zero SP stories without crashing", () => {
    const stories: StoryEstimate[] = [
      {
        storyId: "US-001",
        title: "Zero",
        sp: 0,
        roles: ["TS"],
        rawHours: 0,
        withOverhead: 0,
      },
    ];
    const report = computeEffort(stories, defaultRoles, 1.25);
    expect(report.totalRawHours).toBe(0);
    expect(report.totalWithOverhead).toBe(0);
  });
});

describe("FR-012: resolveRoleMultipliers — config override", () => {
  // TR-013: Config override TS=6 takes precedence
  it("TR-013: uses canonical defaults when no config overrides exist", () => {
    const roles = resolveRoleMultipliers({
      project: { name: "test" },
      agents: { define: "gemini", implement: "codex" },
    } as never);

    const ts = roles.find((r: RoleConfig) => r.role === "TS");
    expect(ts).toBeDefined();
    expect(ts?.hoursPerSP).toBe(4);
  });

  it("TR-013: config override TS.hoursPerSP=6 takes precedence over default", () => {
    const roles = resolveRoleMultipliers({
      project: { name: "test" },
      agents: { define: "gemini", implement: "codex" },
      effort: { roles: { TS: { hoursPerSP: 6 } } },
    } as never);

    const ts = roles.find((r: RoleConfig) => r.role === "TS");
    expect(ts).toBeDefined();
    expect(ts?.hoursPerSP).toBe(6);
  });

  it("returns all 5 canonical roles even when no overrides", () => {
    const roles = resolveRoleMultipliers({
      project: { name: "test" },
      agents: { define: "gemini", implement: "codex" },
    } as never);
    expect(roles.length).toBe(5);
    expect(roles.map((r: RoleConfig) => r.role).sort()).toEqual([
      "DE",
      "PE",
      "PM",
      "RE",
      "TS",
    ]);
  });
});

describe("FR-003: writeEffortReport — markdown report generation", () => {
  // TR-003: report file written to docs/assessments/
  it("TR-003: writes markdown file to docs/assessments/effort-<feature>-YYYY-MM-DD.md", () => {
    const report: EffortReport = {
      featureId: "test-feature",
      generatedAt: new Date().toISOString(),
      totalSP: 10,
      overheadFactor: 1.25,
      roles: [],
      stories: [],
      totalRawHours: 40,
      totalWithOverhead: 50,
      totalDays: 6.25,
    };
    const outputPath = writeEffortReport(report, "/tmp/test-assessments");
    expect(outputPath).toMatch(/effort-test-feature-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("report contains Total Story Points header", () => {
    const report: EffortReport = {
      featureId: "test-feature",
      generatedAt: new Date().toISOString(),
      totalSP: 10,
      overheadFactor: 1.25,
      roles: [],
      stories: [],
      totalRawHours: 40,
      totalWithOverhead: 50,
      totalDays: 6.25,
    };
    const outputPath = writeEffortReport(report, "/tmp/test-assessments");
    // File content should contain "Total Story Points"
    const { readFileSync } = require("node:fs");
    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("Total Story Points");
    expect(content).toContain("1.25");
  });
});
