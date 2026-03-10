import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRuns } from "../db/runs.js";
import { runsCommand } from "./runs.js";

vi.mock("../db/runs.js");

describe("runsCommand — CLI and JSON output", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    vi.mocked(listRuns).mockReturnValue([
      {
        id: 1,
        feature_id: "001-cli-core",
        command: "ship",
        agent_backend: "gemini",
        exit_code: 0,
        duration_s: 120,
        started_at: "2026-03-05T12:00:00Z",
      },
      {
        id: 2,
        feature_id: "001-cli-core",
        command: "ship",
        agent_backend: "claude",
        exit_code: null,
        duration_s: null,
        started_at: "2026-03-05T12:05:00Z",
      },
    ] as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles empty runs gracefully", async () => {
    vi.mocked(listRuns).mockReturnValue([]);
    await runsCommand.parseAsync(["node", "cli.js", "001-cli-core"]);

    expect(listRuns).toHaveBeenCalledWith("001-cli-core");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "No runs found for 001-cli-core",
    );
  });

  it("--json flag outputs valid JSON", async () => {
    await runsCommand.parseAsync(["node", "cli.js", "001-cli-core", "--json"]);

    const outputString = consoleLogSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(outputString);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].command).toBe("ship");
    expect(parsed[1].agent_backend).toBe("claude");
  });

  it("prints human readable table", async () => {
    await runsCommand.parseAsync(["node", "cli.js", "001-cli-core"]);
    const fullOutput = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");

    expect(fullOutput).toContain("Execution History: 001-cli-core");
    expect(fullOutput).toContain("✅ 0");
    expect(fullOutput).toContain("⏳");
    expect(fullOutput).toContain("Total: 2 runs");
  });
});
