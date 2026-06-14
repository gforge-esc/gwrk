import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ensureRegistry } from "./registry.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("FR-044: Registry Cloning", () => {
  const homeDir = path.join(os.tmpdir(), "gwrk-home-" + Math.random().toString(36).slice(2));

  beforeEach(() => {
    vi.mock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => homeDir };
    });
    if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("TR-036: clones gwrk-plugins registry to ~/.gwrk/registry if missing", async () => {
    const registryDir = path.join(homeDir, ".gwrk", "registry");
    
    await ensureRegistry();
    
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("git clone https://github.com/gwrk-org/gwrk-plugins"),
      expect.any(Object)
    );
  });

  it("updates registry if already present", async () => {
    const registryDir = path.join(homeDir, ".gwrk", "registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(path.join(registryDir, ".git"), { recursive: true });
    
    await ensureRegistry();
    
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("git pull"),
      expect.objectContaining({ cwd: registryDir })
    );
  });
});
