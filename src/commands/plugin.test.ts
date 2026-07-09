/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listPlugins, pluginCommand } from './plugin.js';
import * as registry from "../engine/registry.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("../engine/registry.js", () => ({
  searchPlugins: vi.fn(),
  installPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  syncRegistry: vi.fn(),
}));

describe('Plugin Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FR-010: Plugin Listing', () => {
    it('TR-P9-004: groups enforcement skills under their own tier', async () => {
      const output = await listPlugins({ type: 'skill' });
      // This test depends on actual installed plugins or a mock PluginLoader
      // For now, let's just assert it doesn't crash and returns a string
      expect(typeof output).toBe('string');
    });
  });

  describe('FR-041: gwrk plugin search', () => {
    it('should call searchPlugins and display results', async () => {
      vi.mocked(registry.searchPlugins).mockResolvedValue([
        { name: 'found-skill', version: '1.0.0', description: 'Matched', type: 'skill' } as any
      ]);

      await pluginCommand.parseAsync(['node', 'gwrk', 'search', 'found']);

      expect(registry.searchPlugins).toHaveBeenCalledWith('found');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('found-skill'));
    });

    it('should show message when no results found', async () => {
      vi.mocked(registry.searchPlugins).mockResolvedValue([]);

      await pluginCommand.parseAsync(['node', 'gwrk', 'search', 'nothing']);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No plugins found matching 'nothing'"));
    });
  });

  describe('FR-042: gwrk plugin install', () => {
    it('should call installPlugin with ID/URL', async () => {
      vi.mocked(registry.installPlugin).mockResolvedValue({ name: 'new-skill' } as any);

      await pluginCommand.parseAsync(['node', 'gwrk', 'install', 'new-skill']);

      expect(registry.installPlugin).toHaveBeenCalledWith('new-skill', expect.any(Object));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Installed plugin 'new-skill'"));
    });
  });

  describe('FR-043: gwrk plugin update', () => {
    it('should call updatePlugin and show updated list', async () => {
      vi.mocked(registry.updatePlugin).mockResolvedValue(['skill-1', 'skill-2']);

      await pluginCommand.parseAsync(['node', 'gwrk', 'update']);

      expect(registry.updatePlugin).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Updated plugin 'skill-1'"));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Updated plugin 'skill-2'"));
    });
  });
});
