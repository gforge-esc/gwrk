import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as uiModule from "../utils/format.js";
import * as stateModule from "../utils/state.js";
import { testCommand } from "./test.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../utils/format.js", () => ({
  fail: vi.fn(),
  success: vi.fn(),
  banner: vi.fn(),
  color: {
    BOLD: "",
    DIM: "",
    CYAN: "",
    GREEN: "",
    YELLOW: "",
    RED: "",
    MAGENTA: "",
    RESET: "",
  },
}));

vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn(),
}));

describe("testCommand", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(testCommand);

    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  it("should run vitest for all test files in a feature", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-01",
          tasks: [
            { id: "T001", title: "Implement src/cli.ts", status: "open" },
          ],
        },
      ],
    } as any);

    // Mock fs.existsSync to return true for the test file
    vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && p.includes("src/cli.test.ts")) return true;
      if (typeof p === "string" && p.includes("specs/001-cli-core")) return true;
      return false;
    });

    await program.parseAsync(["node", "test", "test", "001-cli-core"]);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("pnpm vitest run src/cli.test.ts"),
      expect.any(Object)
    );
    expect(uiModule.success).toHaveBeenCalled();
  });

  it("should filter by phase", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-01",
          tasks: [{ id: "T001", title: "src/a.test.ts", status: "open" }],
        },
        {
          id: "phase-02",
          tasks: [{ id: "T002", title: "src/b.test.ts", status: "open" }],
        },
      ],
    } as any);

    await program.parseAsync(["node", "test", "test", "001-cli-core", "--phase", "1"]);

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("pnpm vitest run src/a.test.ts"),
      expect.any(Object)
    );
    expect(execSync).not.toHaveBeenCalledWith(
      expect.stringContaining("src/b.test.ts"),
      expect.any(Object)
    );
  });

  it("should exit 1 if vitest fails", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-01",
          tasks: [{ id: "T001", title: "src/cli.test.ts", status: "open" }],
        },
      ],
    } as any);

    const error = new Error("vitest failed");
    (error as any).status = 1;
    vi.mocked(execSync).mockImplementation(() => {
      throw error;
    });

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "test", "001-cli-core"]);
    
    expect(process.exitCode).toBe(1);
    expect(uiModule.fail).toHaveBeenCalledWith("test", 1, expect.any(Number));
  });
});
