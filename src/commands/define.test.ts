import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineCommand } from "./define.js";
import { startRun, finishRun } from "../db/runs.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../utils/config.js";

vi.mock("../db/runs.js");
vi.mock("../utils/exec.js");
vi.mock("../utils/config.js");

describe("defineCommand — Define Until Solid wrapper", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((err) => { process.stderr.write(err + "\n"); });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(process, "cwd").mockReturnValue("/Users/gonzo/Code/gwrk");

    vi.mocked(loadConfig).mockReturnValue({
      project: { name: "gwrk" },
      agents: { define: "gemini", implement: "claude" },
      server: {
        port: 18790,
        host: "localhost",
      },
      parallelism: {
        local: {
          maxCpu: 80,
          maxMem: 80,
          minDiskGb: 10,
          maxClones: 2,
        },
        cloud: {
          maxConcurrent: 10,
        },
      },
    } as any);

    vi.mocked(startRun).mockReturnValue(42);
    vi.mocked(run).mockResolvedValue(true as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails if feature is not provided", async () => {
    let _err: Error | undefined;
    try {
      await defineCommand.parseAsync(["node", "cli.js"]);
    } catch (e) {
      _err = e as Error;
    }
    expect(_err).toBeDefined();
    expect(startRun).not.toHaveBeenCalled();
  });

  it("handles --dry-run without executing scripts", async () => {
    await defineCommand.parseAsync(["node", "cli.js", "004-ship-loop", "--dry-run"]);
    
    expect(startRun).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    
    const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("[DRY RUN]");
    expect(output).toContain("define-until-solid.sh 004-ship-loop");
  });

  it("executes define scripts and records success", async () => {
    await defineCommand.parseAsync(["node", "cli.js", "004-ship-loop"]);
    
    expect(loadConfig).toHaveBeenCalled();
    expect(startRun).toHaveBeenCalledWith({
      feature_id: "004-ship-loop",
      command: "define",
      agent_backend: "gemini",
      workflow: "define-until-solid",
    });

    expect(run).toHaveBeenCalled();
    const [scriptPath, args, opts] = vi.mocked(run).mock.calls[0]!;
    expect(scriptPath).toContain("scripts/dev/define-until-solid.sh");
    expect(args).toEqual(["004-ship-loop"]);
    expect(opts?.cwd).toBe("/Users/gonzo/Code/gwrk");

    expect(finishRun).toHaveBeenCalledWith(42, expect.objectContaining({ exit_code: 0 }));
    
    const output = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(output).toContain("define");
    expect(output).toContain("complete");
  });

  it("records failure when script execution throws", async () => {
    const mockError = new Error("Command failed");
    (mockError as any).exitCode = 2;
    vi.mocked(run).mockRejectedValue(mockError);

    let _err: Error | undefined;
    try {
      await defineCommand.parseAsync(["node", "cli.js", "004-ship-loop"]);
    } catch (e) {
      _err = e as Error;
    }
    
    expect(_err).toBeDefined();
    expect(_err?.message).toBe("process.exit(2)");

    expect(finishRun).toHaveBeenCalledWith(42, expect.objectContaining({ exit_code: 2 }));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
