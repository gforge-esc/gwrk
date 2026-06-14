import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectExtensions } from "./extension-detector.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("FR-045: Extension Discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-037: detects obsidian-cli if installed", async () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (typeof cmd === 'string' && cmd.includes('which obsidian-cli')) {
        return Buffer.from('/usr/local/bin/obsidian-cli');
      }
      throw new Error('Command failed');
    });

    const extensions = await detectExtensions();
    expect(extensions).toBeDefined();
    expect(extensions).toHaveProperty("obsidian-cli");
    expect(extensions["obsidian-cli"]).toBe("/usr/local/bin/obsidian-cli");
  });

  it("returns empty object if no known extensions found", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Not found');
    });

    const extensions = await detectExtensions();
    expect(Object.keys(extensions).length).toBe(0);
  });
});
