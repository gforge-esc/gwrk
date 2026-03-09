import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { shipCommand } from "./ship.js";
import * as execModule from "../utils/exec.js";
import * as runsModule from "../db/runs.js";
import * as uiModule from "../utils/format.js";

// Mock dependencies
vi.mock("../utils/exec.js", () => ({
    run: vi.fn(),
    runGate: vi.fn(),
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
    recordHistory: vi.fn(),
}));

vi.mock("../utils/format.js", () => ({
    fail: vi.fn(),
    success: vi.fn(),
    banner: vi.fn(),
    dryRun: vi.fn(),
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

vi.mock("../utils/manifest.js", () => ({
    writeManifest: vi.fn(),
    generateRunId: vi.fn().mockReturnValue("mock-run-id"),
}));

vi.mock("../utils/git.js", () => ({
    getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
    getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
    getDiffStats: vi.fn().mockReturnValue({ filesChanged: 1, linesAdded: 1, linesDeleted: 1 }),
}));

describe("shipCommand", () => {
    let mockRun: any;
    let program: Command;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRun = vi.mocked(execModule.run);

        // Create a fresh program for each test
        program = new Command();
        program.addCommand(shipCommand);

        // Prevent process.exit from killing the vitest runner
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit unexpectedly called with "${code}"`);
        });
    });

    it("ship should execute scripts/dev/work-until-done.sh (full lifecycle)", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await program.parseAsync(["node", "test", "ship", "001-cli-core", "7"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [scriptPath, args] = mockRun.mock.calls[0];

        expect(scriptPath).toContain("work-until-done.sh");
        expect(args).toEqual(["001-cli-core", "7"]);
        
        expect(runsModule.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
                command: "ship",
                workflow: "work-until-done",
            })
        );
    });

    it("ship should pass custom max-iterations", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1", "--max-iterations", "5"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [, , options] = mockRun.mock.calls[0];
        expect(options.env.MAX_ITERATIONS).toBe("5");
    });

    it("ship should pass custom ci-timeout", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1", "--ci-timeout", "60"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [, , options] = mockRun.mock.calls[0];
        expect(options.env.CI_TIMEOUT).toBe("60");
    });

    it("should safely handle execution failures", async () => {
        const errorWithCode = new Error("shell error");
        (errorWithCode as any).code = 127;
        mockRun.mockRejectedValueOnce(errorWithCode);

        await expect(program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]))
            .rejects.toThrow('process.exit unexpectedly called with "127"');

        expect(runsModule.finishRun).toHaveBeenCalledWith(999, expect.objectContaining({ exit_code: 127 }));
        expect(uiModule.fail).toHaveBeenCalled();
    });

    it("should support dry-run mode", async () => {
        await program.parseAsync(["node", "test", "ship", "--dry-run", "001-cli-core", "1"]);

        expect(execModule.run).not.toHaveBeenCalled();
        expect(uiModule.dryRun).toHaveBeenCalled();
    });
});
