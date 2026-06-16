/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverProject } from "./discover.js";
import fs from "node:fs";
import path from "node:path";
import * as execUtils from "../utils/exec.js";

vi.mock("node:fs");
vi.mock("../utils/exec.js");

describe("discoverProject", () => {
  const mockCwd = "/test-project";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should assemble project state from repository", async () => {
    // Mock fs
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      if (p.toString().endsWith(".gwrkrc.json")) return true;
      if (p.toString().endsWith("specs")) return true;
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      if (p.toString().endsWith(".gwrkrc.json")) {
        return JSON.stringify({
          project: { name: "test-app" },
          agents: { define: "gemini", implement: "claude" }
        });
      }
      return "";
    });

    vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
      if (p.toString().endsWith("specs")) return ["001-cli-core"] as any;
      return [];
    });

    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);

    // Mock execCommand
    vi.mocked(execUtils.execCommand).mockImplementation(async (cmd, args) => {
      if (cmd === "git") {
        if (args[0] === "branch") return { exitCode: 0, stdout: "main", stderr: "" };
        if (args[0] === "status") return { exitCode: 0, stdout: "", stderr: "" };
        if (args[0] === "log") return { exitCode: 0, stdout: "a1b2c3d initial commit", stderr: "" };
      }
      if (cmd === "which") return { exitCode: 0, stdout: "/usr/local/bin/" + args[0], stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const result = await discoverProject(mockCwd);

    expect(result.project.name).toBe("test-app");
    expect(result.project.git.branch).toBe("main");
    expect(result.project.git.clean).toBe(true);
    expect(result.specs.length).toBe(1);
    expect(result.specs[0].id).toBe("001");
    expect(result.config.agents).toContain("gemini");
  });
});
