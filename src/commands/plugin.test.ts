/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { listPlugins } from './plugin.js';

describe('FR-010: Plugin Listing', () => {
  it('TR-P9-004: groups enforcement skills under their own tier', async () => {
    // Mock output capture or return value
    const output = await listPlugins({ type: 'skill' });
    expect(output).toContain('SKILLS'); // Groups are uppercase in listPlugins
    expect(output).toContain('[enforcement]');
    expect(output).toContain('typescript-standards');
  });
});
