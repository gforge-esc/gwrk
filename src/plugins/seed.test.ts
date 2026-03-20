import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
// @ts-ignore - Module does not exist yet (RED)
import { seedSkills } from "./seed.js";

vi.mock("node:fs/promises");

describe("FR-012: Skill Seeding (Taxonomy to Skills)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-010: parses reasoning-modes.md and generates atomic skill plugins", async () => {
    // Mocking reasoning-modes.md content
    vi.mocked(fs.readFile).mockResolvedValue(`## reasoning
### narrative
**Prompt:** You are a narrator...
`);

    await seedSkills();

    // Verify it attempted to write manifest.yaml and SKILL.md for 'narrative'
    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("narrative/manifest.yaml"),
        expect.stringContaining("tier: atomic")
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("narrative/SKILL.md"),
        expect.stringContaining("You are a narrator")
    );
  });

  it("US-010: preserves categories from the taxonomy", async () => {
    // Should extract 'reasoning' category
  });

  it("US-010: supports --dry-run mode", async () => {
    await seedSkills({ dryRun: true });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
