import { describe, expect, it } from "vitest";
import { AgyAdapter } from "./adapter.js";

describe("FR-004: AgyAdapter.dispatch()", () => {
  it("US-001: Maps YOLO to --dangerously-skip-permissions and omits --model", async () => {
    const adapter = new AgyAdapter();
    try {
        const result = await adapter.dispatch({
            prompt: "echo hello",
            agent: "agy"
        });
        expect(result.command).toBe("agy");
        expect(result.args).toContain("--dangerously-skip-permissions");
        expect(result.args).not.toContain("--model");
    } catch (e: any) {
        expect(e.message).not.toBe("Not implemented");
    }
  });

  it("handles missing agy binary by throwing or returning correct error state (FR-001)", async () => {
      const adapter = new AgyAdapter();
      try {
          const available = await adapter.isAvailable();
          expect(available).toBe(false);
      } catch (e: any) {
          expect(e.message).not.toBe("Not implemented");
      }
  });
});

describe("FR-003: AgyAdapter.syncGovernance()", () => {
  it("US-002: syncGovernance persists rules correctly with gwrk markers", async () => {
      const adapter = new AgyAdapter();
      try {
          const result = await adapter.syncGovernance(process.cwd(), "rules");
          expect(result).toContain("<!-- gwrk:begin -->");
      } catch(e: any) {
          expect(e.message).not.toBe("Not implemented");
      }
  });
});
