import { Command } from "commander";
import { describe, expect, it, vi, beforeEach } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { pluginCommand } from "./plugin.js";

describe("FR-001 / FR-003 / FR-004 / FR-005: Plugin CLI Commands", () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(pluginCommand);
    vi.clearAllMocks();
  });

  describe("gwrk plugin install (FR-001 / US-001)", () => {
    it("rejects install if manifest.yaml is missing", async () => {
      // Mock loader to fail if manifest missing
      // Should exit 1 with "No manifest.yaml found"
    });

    it("validates manifest before install", async () => {
      // Mock manifest with invalid schema
      // Should exit 1 with Zod error
    });

    it("successfully installs a valid plugin to ~/.gwrk/plugins/", async () => {
      // Mock success path
      // Verify filesystem copy called
    });

    it("requires --force if plugin already exists", async () => {
        // Mock existing plugin
        // Should exit 1 without --force
    });
  });

  describe("gwrk plugin list (FR-003 / US-002)", () => {
    it("groups installed plugins by type", async () => {
        // Mock loader.listPlugins
        // Verify output formatting
    });

    it("supports --format json", async () => {
        // Verify JSON output
    });

    it("shows resolution with --project flag", async () => {
        // Mock local overrides/disables
    });
  });

  describe("gwrk plugin remove (FR-004 / US-003)", () => {
    it("warns and fails if other plugins depend on it", async () => {
        // Mock dependency check
        // Should exit 1 without --force
    });

    it("successfully removes plugin with --force", async () => {
        // Verify deletion called
    });
  });

  describe("gwrk plugin disable/enable (FR-005 / US-004)", () => {
    it("writes to .gwrk/plugins.yaml on disable", async () => {
        // Verify file write
    });

    it("removes from .gwrk/plugins.yaml on enable", async () => {
        // Verify file update
    });

    it("rejects disable for skills (FR-005)", async () => {
        // Should exit 1 with "Skills are global-only"
    });
  });
});
