import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statsCommand } from "./stats.js";
import { getStats } from "../db/runs.js";
import type { RunStats } from "../db/runs.js";

vi.mock("../db/runs.js");

describe("FR: statsCommand — CLI and JSON output", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((err) => { process.stderr.write(err + "\n"); });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    vi.mocked(getStats).mockReturnValue([
      {
        command: "wud",
        agent_backend: "gemini",
        workflow: "work-until-done",
        total_runs: 10,
        success_runs: 8,
        avg_duration_s: 120.5,
      },
      {
        command: "define",
        agent_backend: "claude",
        workflow: "define-until-solid",
        total_runs: 5,
        success_runs: 5,
        avg_duration_s: 45.0,
      }
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--json flag outputs valid JSON with stats schema", async () => {
    let _err: Error | undefined;
    try {
      await statsCommand.parseAsync(["node", "cli.js", "--json"]);
    } catch (e) {
      _err = e as Error;
    }
    expect(_err).toBeUndefined();

    // Verify getStats was called
    expect(getStats).toHaveBeenCalledTimes(1);

    // Grab the first line of output
    const outputString = consoleLogSpy.mock.calls[0]![0];
    const parsed = JSON.parse(outputString);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].command).toBe("wud");
    expect(parsed[1].success_runs).toBe(5);
  });

  it("prints human readable success message when --json is omitted", async () => {
    let _err: Error | undefined;
    try {
      await statsCommand.parseAsync(["node", "cli.js"]);
    } catch (e) {
      _err = e as Error;
    }
    expect(_err).toBeUndefined();

    expect(getStats).toHaveBeenCalledTimes(1);

    const fullOutput = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(fullOutput).toContain("=== EXECUTION STATISTICS ===");
    expect(fullOutput).toContain("wud");
    expect(fullOutput).toContain("80%");
    expect(fullOutput).toContain("121s");
    expect(fullOutput).toContain("define");
    expect(fullOutput).toContain("100%");
  });

  it("handles empty database gracefully", async () => {
    vi.mocked(getStats).mockReturnValue([]);
    
    let _err: Error | undefined;
    try {
      await statsCommand.parseAsync(["node", "cli.js"]);
    } catch (e) {
      _err = e as Error;
    }
    expect(_err).toBeUndefined();

    const fullOutput = consoleLogSpy.mock.calls.map(c => c[0]).join("\n");
    expect(fullOutput).toContain("No completed runs found");
  });
});
