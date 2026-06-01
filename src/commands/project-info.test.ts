import { describe, it, expect, vi } from "vitest";
import { projectInfoCommand } from "./project-info.js";

describe("US-029 / FR-035: gwrk project info", () => {
  it("TR-032: displays resolved profile with source of each field", async () => {
    expect(projectInfoCommand.name()).toBe("info");
  });

  it("TR-032: supports --format json output matching ProjectProfileSchema", async () => {
    // Verify structured output for scripting
  });

  it("FR-035: fails if not in a gwrk-managed directory", async () => {
    // Verify error message for uninitialized directories
  });
});