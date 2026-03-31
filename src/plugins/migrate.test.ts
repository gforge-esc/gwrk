import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { migrateSkills } from "./migrate.js";

vi.mock("node:fs/promises");

describe("FR-011: Skill Migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-009: generates valid manifest.yaml from SKILL.md frontmatter", async () => {
    // Mock readdir to return truth-extract
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: "truth-extract", isDirectory: () => true }
    ] as any);

    // Mock fs.stat to throw (not found)
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    // Mock existence of .agents/skills/truth-extract/SKILL.md
    vi.mocked(fs.readFile).mockResolvedValue(`---
name: truth-extract
category: reasoning
description: Forensic analysis
---
# Truth Extract`);

    await migrateSkills();

    // Verify it attempted to write manifest.yaml at destination
    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("manifest.yaml"),
        expect.stringContaining("type: skill")
    );
  });

  it("US-009: skips migration if plugin already exists at destination", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      await migrateSkills();
      expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
