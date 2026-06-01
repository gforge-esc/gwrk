import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { seedSkills } from "./seed.js";

vi.mock("node:fs/promises");
vi.mock("node:os");

describe("TR-006: seed()", () => {
  const mockHome = "/mock/home";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
  });

  it("preserves categories from taxonomy", async () => {
    const taxonomyContent = `Reasoning Modes

1. **Analytical** - Break down structure.
    > "ANALYZE THIS"

---

Evaluative Modes

1. **Adversarial** - Attack the idea.
    > "ATTACK THIS"
`;

    vi.mocked(fs.readFile).mockResolvedValue(taxonomyContent);
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    await seedSkills();

    // Check reasoning skill
    const analyticalManifestPath = path.join(
      mockHome,
      ".gwrk",
      "plugins",
      "skills",
      "analytical",
      "manifest.yaml",
    );
    const analyticalCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((call) => call[0] === analyticalManifestPath);
    expect(analyticalCall).toBeDefined();
    const analyticalManifest = parse(analyticalCall![1] as string);
    expect(analyticalManifest.category).toBe("reasoning");

    // Check evaluative skill
    const adversarialManifestPath = path.join(
      mockHome,
      ".gwrk",
      "plugins",
      "skills",
      "adversarial",
      "manifest.yaml",
    );
    const adversarialCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((call) => call[0] === adversarialManifestPath);
    expect(adversarialCall).toBeDefined();
    const adversarialManifest = parse(adversarialCall![1] as string);
    expect(adversarialManifest.category).toBe("evaluative");
  });
});
