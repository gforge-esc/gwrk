import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgyAdapter } from "./adapter.js";

vi.mock("../../../../utils/exec.js", () => ({
  execCommand: vi.fn(),
}));

describe("AgyAdapter (Antigravity CLI)", () => {
  let adapter: AgyAdapter;

  beforeEach(() => {
    adapter = new AgyAdapter();
    vi.resetAllMocks();
  });

  describe("isAvailable()", () => {
    it("returns true when agy CLI is installed", async () => {
      const { execCommand } = await import("../../../../utils/exec.js");
      vi.mocked(execCommand).mockResolvedValue({ exitCode: 0, stdout: "/Users/gonzo/.local/bin/agy", stderr: "" });

      expect(await adapter.isAvailable()).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("which", ["agy"]);
    });

    it("returns false when agy CLI is not installed", async () => {
      const { execCommand } = await import("../../../../utils/exec.js");
      vi.mocked(execCommand).mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });

      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("dispatch()", () => {
    it("produces correct command line with --print and --dangerously-skip-permissions", async () => {
      const result = await adapter.dispatch({
        prompt: "implement the feature",
        featureDir: "specs/001-cli-core",
        workflow: "gwrk-implement.md",
        stdin: "context data",
      });

      expect(result.command).toBe("agy");
      expect(result.args).toContain("--print");
      expect(result.args).toContain("--dangerously-skip-permissions");
      expect(result.stdin).toBe("context data");

      // Verify prompt is assembled correctly
      const printIndex = result.args.indexOf("--print");
      const prompt = result.args[printIndex + 1];
      expect(prompt).toContain("/gwrk-implement");
      expect(prompt).toContain("specs/001-cli-core");
      expect(prompt).toContain("implement the feature");
    });

    it("handles dispatch with no workflow", async () => {
      const result = await adapter.dispatch({
        prompt: "do something",
        stdin: "",
      });

      expect(result.command).toBe("agy");
      expect(result.args).toContain("--dangerously-skip-permissions");
      const printIndex = result.args.indexOf("--print");
      expect(result.args[printIndex + 1]).toContain("do something");
    });

    it("does NOT add --sandbox or --approval-mode (agy-specific)", async () => {
      const result = await adapter.dispatch({
        prompt: "test",
        stdin: "",
      });

      expect(result.args).not.toContain("--sandbox");
      expect(result.args).not.toContain("--approval-mode");
      expect(result.args).not.toContain("yolo");
    });
  });

  describe("parseResult()", () => {
    it("normalizes exit code 0 as success", () => {
      const result = adapter.parseResult("output", "", 0);
      expect(result.exitCode).toBe(0);
      expect(result.errorType).toBeUndefined();
    });

    it("preserves exit code 1 as general error", () => {
      const result = adapter.parseResult("", "error", 1);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBeUndefined();
    });

    it("preserves exit code 2 as usage error", () => {
      const result = adapter.parseResult("", "bad flags", 2);
      expect(result.exitCode).toBe(2);
      expect(result.errorType).toBeUndefined();
    });

    it("normalizes unknown exit codes > 2 to 1 (agent_error)", () => {
      const result = adapter.parseResult("", "crash", 53);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBe("agent_error");
    });

    it("preserves exit code 127 (command not found)", () => {
      const result = adapter.parseResult("", "not found", 127);
      expect(result.exitCode).toBe(127);
      expect(result.errorType).toBeUndefined();
    });
  });

  describe("syncGovernance()", () => {
    it("writes AGENTS.md (not GEMINI.md)", async () => {
      const fsSync = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "agy-test-"));

      try {
        const result = await adapter.syncGovernance(tmpDir, "# GWRK Context");

        const written = fsSync.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
        expect(written).toContain("# GWRK Context");
        expect(written).toContain("<!-- gwrk:begin -->");
        expect(written).toContain("<!-- gwrk:end -->");
        expect(result).toContain("# GWRK Context");

        // Verify it wrote AGENTS.md, not GEMINI.md
        expect(fsSync.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
        expect(fsSync.existsSync(path.join(tmpDir, "GEMINI.md"))).toBe(false);
      } finally {
        fsSync.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("preserves content outside gwrk markers", async () => {
      const fsSync = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "agy-test-"));

      try {
        const existingContent = "# AGENTS Project Context\n\nCustom rules here\n\n<!-- gwrk:begin -->\nold content\n<!-- gwrk:end -->\n\nMore custom rules";
        fsSync.writeFileSync(path.join(tmpDir, "AGENTS.md"), existingContent);

        const result = await adapter.syncGovernance(tmpDir, "new governance");

        expect(result).toContain("Custom rules here");
        expect(result).toContain("new governance");
        expect(result).toContain("More custom rules");
        expect(result).not.toContain("old content");
      } finally {
        fsSync.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("identity", () => {
    it("has name 'agy'", () => {
      expect(adapter.name).toBe("agy");
    });
  });
});
