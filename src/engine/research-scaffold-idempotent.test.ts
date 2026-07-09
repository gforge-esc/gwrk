/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResearchScaffolder } from "./research-scaffold.js";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

/**
 * RED tests for research scaffold idempotency and resolve-by-prefix.
 * These test the three bugs identified in the research feature audit:
 * 1. Scaffold same name twice → should return existing dir, not create new
 * 2. resolveByPrefix("R011") → should find existing research dir
 * 3. Brief content should be accessible after scaffold
 */
describe("ResearchScaffolder Idempotency (Audit Fix)", () => {
  const scaffolder = new ResearchScaffolder();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("scaffold same initiative name twice returns existing directory instead of creating new", async () => {
    // First call: R001-my-research exists, R002-other exists
    // scaffold("my-research") should find R001-my-research and return it
    (fs.readdir as any).mockResolvedValue([
      "R001-my-research",
      "R002-other-thing",
    ]);
    // Stat to verify the dir exists
    (fs.stat as any).mockResolvedValue({ isDirectory: () => true });

    const result = await scaffolder.scaffold("my-research");

    // Should return existing R001, NOT create R003
    expect(result.directory).toBe("docs/research/R001-my-research");
    // Should NOT create a new directory
    expect(fs.mkdir).not.toHaveBeenCalledWith(
      expect.stringContaining("R003"),
      expect.anything(),
    );
    // Should NOT write a new brief.md over the existing one
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("scaffold with different name still creates new directory", async () => {
    (fs.readdir as any).mockResolvedValue([
      "R001-existing-research",
    ]);

    const result = await scaffolder.scaffold("brand-new-topic");

    // Should create R002 since "brand-new-topic" doesn't match any existing
    expect(result.directory).toBe("docs/research/R002-brand-new-topic");
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining("R002-brand-new-topic"),
      { recursive: true },
    );
  });
});

describe("ResearchScaffolder resolveByPrefix", () => {
  const scaffolder = new ResearchScaffolder();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolveByPrefix finds existing research directory by R0XX prefix", async () => {
    (fs.readdir as any).mockResolvedValue([
      "R001-parallel-dispatch",
      "R011-obsidian-vault-as-discovery-source",
    ]);

    const result = await scaffolder.resolveByPrefix("R011");

    expect(result).toEqual({
      directory: "docs/research/R011-obsidian-vault-as-discovery-source",
    });
  });

  it("resolveByPrefix throws if prefix not found", async () => {
    (fs.readdir as any).mockResolvedValue([
      "R001-parallel-dispatch",
    ]);

    await expect(scaffolder.resolveByPrefix("R099")).rejects.toThrow(
      /R099.*not found/i,
    );
  });

  it("resolveByPrefix is case-insensitive on prefix", async () => {
    (fs.readdir as any).mockResolvedValue([
      "R011-obsidian-vault",
    ]);

    const result = await scaffolder.resolveByPrefix("r011");

    expect(result).toEqual({
      directory: "docs/research/R011-obsidian-vault",
    });
  });
});
