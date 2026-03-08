import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { shipCommand } from "./ship.js";
import * as execModule from "../utils/exec.js";
import * as runsModule from "../db/runs.js";
import * as uiModule from "../utils/format.js";
import * as stateModule from "../utils/state.js";

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

vi.mock("../utils/state.js", () => ({
    loadTaskState: vi.fn().mockReturnValue({
        phases: [{ id: "phase-01", tasks: [{ id: "T001", title: "Task 1", status: "open" }] }]
    }),
    markTaskComplete: vi.fn(),
    saveTaskState: vi.fn(),
}));

vi.mock("../utils/history.js", () => ({
    appendHistory: vi.fn(),
}));

vi.mock("node:fs", () => ({
    default: {
        existsSync: vi.fn().mockReturnValue(true),
    },
    existsSync: vi.fn().mockReturnValue(true),
}));

describe("shipCommand", () => {
    let mockRun: any;
    let program: Command;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRun = vi.mocked(execModule.run);
        vi.mocked(execModule.runGate).mockReturnValue({ exitCode: 1, stdout: "", stderr: "" });

        // Create a fresh program for each test
        program = new Command();
        program.addCommand(shipCommand);

        // Prevent process.exit from killing the vitest runner
        vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit unexpectedly called with "${code}"`);
        });
    });

    it("ship done should execute scripts/dev/work-until-done.sh (US-013)", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await program.parseAsync(["node", "test", "ship", "done", "001-cli-core", "7"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [scriptPath, args] = mockRun.mock.calls[0];

        expect(scriptPath).toContain("work-until-done.sh");
        expect(args).toEqual(["001-cli-core", "7"]);
        
        expect(runsModule.startRun).toHaveBeenCalledWith(
            expect.objectContaining({
                command: "ship done",
                workflow: "work-until-done",
            })
        );
    });

    it("ship (implement) should execute scripts/dev/agent-run.sh implement (US-012)", async () => {
        mockRun.mockResolvedValueOnce(undefined);
        // Pre-flight fail (exit 1), Post-flight pass (exit 0)
        vi.mocked(execModule.runGate)
            .mockReturnValueOnce({ exitCode: 1, stdout: "", stderr: "" })
            .mockReturnValueOnce({ exitCode: 0, stdout: "", stderr: "" });
        
        await program.parseAsync(["node", "test", "ship", "001-cli-core", "1"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [scriptPath, args] = mockRun.mock.calls[0];

        expect(scriptPath).toContain("agent-run.sh");
        expect(args).toEqual(["implement", "001-cli-core", "1", "T001"]);
    });

    it("ship done should pass custom max-iterations", async () => {
        mockRun.mockResolvedValueOnce(undefined);

        await program.parseAsync(["node", "test", "ship", "done", "004-ship-loop", "1", "--max-iterations", "5"]);

        expect(execModule.run).toHaveBeenCalledTimes(1);
        const [, , options] = mockRun.mock.calls[0];
        expect(options.env.MAX_ITERATIONS).toBe("5");
    });

    it("should safely handle execution failures from the ship done script", async () => {
        const errorWithCode = new Error("shell error");
        (errorWithCode as any).code = 127;
        mockRun.mockRejectedValueOnce(errorWithCode);

        await expect(program.parseAsync(["node", "test", "ship", "done", "004-ship-loop", "1"]))
            .rejects.toThrow('process.exit unexpectedly called with "127"');

        expect(runsModule.finishRun).toHaveBeenCalledWith(999, expect.objectContaining({ exit_code: 127 }));
        expect(uiModule.fail).toHaveBeenCalled();
    });

    it("should support dry-run mode on done subcommand", async () => {
        await program.parseAsync(["node", "test", "ship", "done", "001-cli-core", "7", "--dry-run"]);

        expect(execModule.run).not.toHaveBeenCalled();
        expect(uiModule.dryRun).toHaveBeenCalled();
    });

    it("should support dry-run mode on main ship command", async () => {
        await program.parseAsync(["node", "test", "ship", "--dry-run", "001-cli-core", "1"]);

        expect(execModule.run).not.toHaveBeenCalled();
        expect(uiModule.dryRun).toHaveBeenCalled();
    });
});
