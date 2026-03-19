import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
// @ts-ignore - Function may not exist yet (RED)
import { getGlobalPluginDir } from "./config.js";

describe("FR-001: Global Plugin Directory Configuration", () => {
  it("US-001: returns the default global plugin directory in ~/.gwrk/plugins", () => {
    const expected = path.join(os.homedir(), ".gwrk", "plugins");
    const result = getGlobalPluginDir();
    expect(result).toBe(expected);
  });
});
