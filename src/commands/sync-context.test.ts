/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { syncAgentContext } from "./sync-context.js";
import { AgentBackendRegistry } from "../plugins/agent-registry.js";

vi.mock("../plugins/agent-registry.js");
vi.mock("../plugins/loader.js");

describe("gwrk plugin sync-context", () => {
  const tmpDir = path.join(os.tmpdir(), `gwrk-sync-test-${Math.random().toString(36).slice(2)}`);

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("FR-L1-006: syncAgentContext() reads .gwrk/agent-context.md and calls syncAllBackends", async () => {
    const gwrkDir = path.join(tmpDir, ".gwrk");
    await fs.mkdir(gwrkDir, { recursive: true });
    const contextPath = path.join(gwrkDir, "agent-context.md");
    const governance = "# Test Governance";
    await fs.writeFile(contextPath, governance);

    const mockSyncAll = vi.fn().mockResolvedValue(undefined);
    (AgentBackendRegistry as any).mockImplementation(() => ({
      syncAllBackends: mockSyncAll
    }));

    await syncAgentContext();

    expect(mockSyncAll).toHaveBeenCalledWith(tmpDir, governance);
  });

  it("warns if .gwrk/agent-context.md is missing but still calls syncAllBackends with empty string", async () => {
    const mockSyncAll = vi.fn().mockResolvedValue(undefined);
    (AgentBackendRegistry as any).mockImplementation(() => ({
      syncAllBackends: mockSyncAll
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await syncAgentContext();

    expect(mockSyncAll).toHaveBeenCalledWith(tmpDir, "");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(".gwrk/agent-context.md not found"));
  });
});
