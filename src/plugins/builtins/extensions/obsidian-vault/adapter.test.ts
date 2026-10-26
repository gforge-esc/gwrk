/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ObsidianAdapter } from "./adapter.js";

describe("TR-019: Built-in Obsidian Vault Extension (Phase 20)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FR-L3-007: returns context items matching keywords", async () => {
    const adapter = new ObsidianAdapter();
    const results = await adapter.resolveContext({
      keywords: ["test"],
      projectRoot: "/fake",
      config: { vaultPath: "/fake/vault" },
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: expect.any(String) }),
      ]),
    );
  });

  it("US-027: scans real vault markdown notes and ranks matches by keyword relevance", async () => {
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-obsidian-test-"));
    tempDirs.push(vaultDir);

    fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
    fs.writeFileSync(
      path.join(vaultDir, ".obsidian", "ignored.md"),
      "Should never be indexed: cold start",
    );
    fs.writeFileSync(
      path.join(vaultDir, "Cold Start Runbook.md"),
      "# Cold Start Runbook\nDeterministic seed=42 simulation harness for ERCOT.",
    );
    fs.writeFileSync(
      path.join(vaultDir, "Unrelated Note.md"),
      "# Grocery List\nApples and oranges.",
    );

    const adapter = new ObsidianAdapter();
    const results = await adapter.resolveContext({
      keywords: ["cold start", "ercot"],
      projectRoot: vaultDir,
      config: { vaultPath: vaultDir, vault: "EnergyWork" },
    });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("obsidian://EnergyWork/Cold Start Runbook");
    expect(results[0].content).toContain("Deterministic seed=42");
    expect(results[0].relevance).toBeGreaterThan(0.5);
  });
});
