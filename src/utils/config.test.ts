import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { loadConfig } from "./config.js";

vi.mock("node:fs");

describe("TC-H03 / T004: Config & Environment Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("TC-H03: Config Loading", () => {
    it("TC-003: fails fast if .gwrkrc.json is missing", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      expect(() => loadConfig("/root")).toThrow("Configuration file .gwrkrc.json not found");
    });

    it("Phase 2: loads parallelism settings from config", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        project: { name: "test" },
        agents: { define: "gemini", implement: "gemini" },
        parallelism: {
          local: { maxClones: 2 },
          cloud: { maxConcurrent: 3 }
        }
      }));

      const config = loadConfig("/root");
      expect(config.parallelism.local.maxClones).toBe(2);
      expect(config.parallelism.cloud.maxConcurrent).toBe(3);
    });


  });
});
