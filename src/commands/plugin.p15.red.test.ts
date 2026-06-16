/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listPlugins } from './plugin.js';
import { PluginLoader } from '../plugins/loader.js';
import { detectProfile } from '../engine/profile-detector.js';

// Module does not exist yet (RED)

vi.mock('../plugins/loader.js');
vi.mock('../engine/profile-detector.js');

describe('FR-010 / US-016: Plugin Listing Phase 15 RED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('US-016: plugin list --project filters by profile language', async () => {
    // Setup: project has a TypeScript skill but the profile is Python
    vi.mocked(detectProfile).mockResolvedValue({
      type: 'python',
      stack: { language: 'Python' },
    } as any);

    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    
    // The loader.resolvePlugin will return the manifest with language: 'TypeScript'
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'typescript-standards', type: 'skill', tier: 'enforcement', language: 'TypeScript' } as any,
      path: '/some/builtin/path',
      status: 'active'
    });

    const output = await listPlugins({ project: true, type: 'skill' });
    
    // Should fail (RED) because plugin command doesn't yet filter list results by profile
    expect(output).not.toContain('typescript-standards');
  });
});
