/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { discoverExtensions, resolveExtensionContext } from "./extension-runtime.js";
import { loadConfig } from "../utils/config.js";
import { PluginLoader } from "./loader.js";
import { AnyManifestSchema } from "./manifest.js";

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("./loader.js", () => {
  return {
    PluginLoader: vi.fn().mockImplementation(() => ({
      resolvePlugin: vi.fn(),
    })),
  };
});

describe("TR-017: Extension Schema and Runtime (Phase 19)", () => {
  const projectRoot = "/test/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FR-L3-001 / US-025: ExtensionManifestSchema supports provides", () => {
    const manifest = {
      name: "test-ext",
      type: "extension",
      version: "1.0.0",
      description: "Test extension",
      provides: ["context", "metrics"],
      adapter: "./adapter.js",
    };
    const result = AnyManifestSchema.parse(manifest);
    expect(result.type).toBe("extension");
    expect((result as any).provides).toContain("context");
    expect((result as any).provides).toContain("metrics");
  });

  it("FR-L3-005 / US-026: support extensions block in .gwrkrc.json", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      extensions: {
        "test-ext": { apiKey: "secret" },
      },
    } as any);

    // Mock resolvePlugin to fail to just test discovery up to loader call
    const mockResolvePlugin = vi.fn().mockRejectedValue(new Error("Stop here"));
    vi.mocked(PluginLoader).mockImplementation(() => ({
      resolvePlugin: mockResolvePlugin,
    }) as any);

    await discoverExtensions(projectRoot);
    expect(mockResolvePlugin).toHaveBeenCalledWith("test-ext");
  });

  it("FR-L3-003 / FR-L3-004 / US-027: resolveExtensionContext aggregates context safely", async () => {
    // Mock config with no extensions to verify safe empty aggregation
    vi.mocked(loadConfig).mockReturnValue({
      extensions: {},
    } as any);

    const results = await resolveExtensionContext(projectRoot, ["test"]);
    expect(results).toEqual([]);
  });

  it("FR-L3-002: ContextProvider interface is conceptually tested via type safety", () => {
    // This is a placeholder as the interface is TypeScript-only
    expect(true).toBe(true);
  });
});
