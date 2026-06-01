import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("TR-P10-004: Slack Agent Legacy Removal", () => {
  it("ADR-007: contains no hardcoded .agents/workflows/ references (TR-P10-004)", () => {
    const source = fs.readFileSync("src/server/slack-agent.ts", "utf8");
    expect(source).not.toContain(".agents/workflows/");
  });

  it("should not contain any .agents/ references in the file (Negative Path)", () => {
    const source = fs.readFileSync("src/server/slack-agent.ts", "utf8");
    const agentsPaths = source.match(/\.agents\//g);
    expect(
      agentsPaths,
      `Found legacy .agents/ paths: ${agentsPaths}`,
    ).toBeNull();
  });
});
