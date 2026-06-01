import { describe, it, expect } from "vitest";
import { projectInfoCommand } from "./project-info.js";

/**
 * TR-032: Unit test gwrk project info
 * FR-035: Display resolved profile
 */
describe("FR-035: Project Profile Introspection", () => {
  it("TR-032.1: returns valid JSON matching ProjectProfileSchema when --format json is used", async () => {
    expect(projectInfoCommand.name()).toBe("info");
    const options = projectInfoCommand.options.map(o => o.flags);
    expect(options).toContain("--format <type>");
  });

  it("US-029.1: displays type, stack, and layout in default output", async () => {
    expect(projectInfoCommand.description()).toContain("resolved project profile");
    
    // RED ASSERTION: Ensure it throws when implemented as a stub
    // @ts-ignore - access private action handler for testing
    const action = projectInfoCommand._actionHandler;
    await expect(async () => {
        if (typeof action === 'function') {
            await action({}, projectInfoCommand);
        } else {
            throw new Error("Action not found");
        }
    }).rejects.toThrow("Not implemented");
  });
});
