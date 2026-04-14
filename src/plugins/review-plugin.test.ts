import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as configUtils from "../utils/config.js";
import * as stateUtils from "../utils/state.js";
import {
  detectProjectType,
  resolveReviewPlugin,
  validatePhaseScope,
} from "./review-plugin.js";

vi.mock("node:fs");
vi.mock("../utils/state.js");
vi.mock("../utils/config.js");

describe("ReviewPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // biome-ignore lint/suspicious/noExplicitAny: mock
    (configUtils.loadConfig as any).mockReturnValue({
      review: { strategy: undefined },
    });
  });

  describe("detectProjectType", () => {
    it("should detect webapp from markers", () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockImplementation((p: string) =>
        p.endsWith("next.config.js"),
      );
      expect(detectProjectType("/root")).toBe("webapp");
    });

    it("should detect cli from package.json bin", () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockImplementation((p: string) =>
        p.endsWith("package.json"),
      );
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.readFileSync as any).mockReturnValue(
        JSON.stringify({ bin: { gwrk: "bin/gwrk" } }),
      );
      expect(detectProjectType("/root")).toBe("cli");
    });

    it("should default to cli", () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockReturnValue(false);
      expect(detectProjectType("/root")).toBe("cli");
    });
  });

  describe("resolveReviewPlugin", () => {
    it("should return webapp plugin for webapp project", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockImplementation((p: string) =>
        p.endsWith("next.config.js"),
      );
      const plugin = await resolveReviewPlugin("/root");
      expect(plugin.projectType).toBe("webapp");
      expect(plugin.codeReviewWorkflow).toBe("review-code-webapp");
    });

    it("should return cli plugin for cli project", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockReturnValue(false);
      const plugin = await resolveReviewPlugin("/root");
      expect(plugin.projectType).toBe("cli");
      expect(plugin.codeReviewWorkflow).toBe("review-code-cli");
    });

    it("should respect config override", async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (configUtils.loadConfig as any).mockReturnValue({
        review: { strategy: "webapp" },
      });
      // Even if it looks like a CLI
      // biome-ignore lint/suspicious/noExplicitAny: mock
      (fs.existsSync as any).mockReturnValue(false);

      const plugin = await resolveReviewPlugin("/root");
      expect(plugin.projectType).toBe("webapp");
    });
  });

  describe("validatePhaseScope", () => {
    it("should revert changes to tasks in other phases", () => {
      const beforeState = {
        phases: [
          { id: "phase-1", tasks: [{ id: "T1", status: "completed" }] },
          { id: "phase-2", tasks: [{ id: "T2", status: "completed" }] },
        ],
      };

      const afterState = {
        phases: [
          { id: "phase-1", tasks: [{ id: "T1", status: "open" }] }, // CURRENT PHASE - should allow change
          { id: "phase-2", tasks: [{ id: "T2", status: "open" }] }, // OTHER PHASE - should REVERT
        ],
      };

      // biome-ignore lint/suspicious/noExplicitAny: mock
      (stateUtils.loadTaskState as any).mockReturnValue(afterState);

      // biome-ignore lint/suspicious/noExplicitAny: mock
      validatePhaseScope("/root", "F1", "phase-1", beforeState as any);

      expect(afterState.phases[0].tasks[0].status).toBe("open"); // Allowed
      expect(afterState.phases[1].tasks[0].status).toBe("completed"); // Reverted
      expect(stateUtils.saveTaskState).toHaveBeenCalled();
    });

    it("should not save if no violations found", () => {
      const beforeState = {
        phases: [{ id: "phase-1", tasks: [{ id: "T1", status: "completed" }] }],
      };

      const afterState = {
        phases: [{ id: "phase-1", tasks: [{ id: "T1", status: "open" }] }],
      };

      // biome-ignore lint/suspicious/noExplicitAny: mock
      (stateUtils.loadTaskState as any).mockReturnValue(afterState);

      // biome-ignore lint/suspicious/noExplicitAny: mock
      validatePhaseScope("/root", "F1", "phase-1", beforeState as any);

      expect(stateUtils.saveTaskState).not.toHaveBeenCalled();
    });
  });
});
