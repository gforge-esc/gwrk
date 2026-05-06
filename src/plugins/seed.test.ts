import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedSkills } from "./seed.js";

vi.mock("node:fs/promises");

describe("FR-012: Skill Seeding (Taxonomy to Skills)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-010: parses reasoning-modes.md and generates atomic skill plugins", async () => {
    // Mocking reasoning-modes.md content
    vi.mocked(fs.readFile).mockResolvedValue(`Reasoning Modes
1. **narrative** - Frame everything as story.
    > "You are a narrator..."
---
Evaluative Modes
1. **adversarial** - Attack the idea.
    > "You are a skeptic..."
`);

    // Mock fs.stat to throw (not found)
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    await seedSkills();

    // Verify it attempted to write manifest.yaml and SKILL.md for 'narrative'
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("narrative/manifest.yaml"),
      expect.stringContaining("tier: atomic"),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("narrative/SKILL.md"),
      expect.stringContaining("You are a narrator"),
    );
  });

  it("US-010: preserves categories from the taxonomy", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(`Creative Modes
1. **generative** - Raw ideation.
    > "No filtering..."
`);
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    await seedSkills();

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("generative/manifest.yaml"),
      expect.stringContaining("category: creative"),
    );
  });

  it("US-010: supports --dry-run mode", async () => {
    await seedSkills({ dryRun: true });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
