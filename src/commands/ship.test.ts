import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import path from "path";
import { shipCommand } from "./ship.js";
import * as execModule from "../utils/exec.js";
import * as configModule from "../utils/config.js";
import * as runsModule from "../db/runs.js";
import * as uiModule from "../utils/format.js";

// Mock dependencies
vi.mock("../utils/exec.js", () => ({
    run: vi.fn(),
}));

vi.mock("../utils/config.js", () => ({
    loadConfig: vi.fn().mockReturnValue({
        agents: {
            implement: "mock-agent",
        },
    }),
}));

vi.mock("../db/runs.js", () => ({
    startRun: vi.fn().mockReturnValue(999),
    finishRun: vi.fn(),
}));

vi.mock("../utils/format.js", () => ({
    fail: vi.fn(),
    success: vi.fn(),
    banner: vi.fn(),
    dryRun: vi.fn(),
}));

describe("shipCommand", () => {
    let mockRun: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRun = vi.mocked(execModule.run);

        // Prevent process.exit from killing the vitest runner
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit unexpectedly called with "${code}"`);
        });
    });

    it("should execute scripts/dev/work-until-done.sh with correct arguments", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await shipCommand.parseAsync(["node", "test", "001-cli-core", "7"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [scriptPath, args, options] = mockRun.mock.calls[0];

        expect(scriptPath).toContain("work-until-done.sh");
        expect(args).toEqual(["001-cli-core", "7"]);
        expect(options.env.MAX_ITERATIONS).toBe("3"); // Default
        expect(options.env.APPROVAL_MODE).toBe("yolo");

        expect(runsModule.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
                feature_id: "001-cli-core",
                phase_id: "phase-07",
                command: "ship",
                workflow: "work-until-done",
            })
        );
        expect(runsModule.finishRun).toHaveBeenCalledWith(999, expect.objectContaining({ exit_code: 0 }));
    });

    it("should pass custom max-iterations down to the script", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await shipCommand.parseAsync(["node", "test", "004-wud-loop", "1", "--max-iterations", "5"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [, , options] = mockRun.mock.calls[0];
        expect(options.env.MAX_ITERATIONS).toBe("5");
    });

    it("should safely handle execution failures from the WUD script", async () => {
        const errorWithCode = new Error("shell error");
        (errorWithCode as any).code = 127;
        mockRun.mockRejectedValueOnce(errorWithCode);

        await expect(shipCommand.parseAsync(["node", "test", "004-wud-loop", "1"]))
            .rejects.toThrow('process.exit unexpectedly called with "127"');

        expect(runsModule.finishRun).toHaveBeenCalledWith(999, expect.objectContaining({ exit_code: 127 }));
        expect(uiModule.fail).toHaveBeenCalled();
    });

    it("should support dry-run mode and bypass execution", async () => {
        // We mock console.log/banner if needed, but for now we just verify exec was skipped
        await shipCommand.parseAsync(["node", "test", "001-cli-core", "7", "--dry-run"]);

        expect(execModule.run).not.toHaveBeenCalled();
        expect(runsModule.startRun).not.toHaveBeenCalled();
    });
});
