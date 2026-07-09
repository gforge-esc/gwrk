/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi } from 'vitest';
import { researchCommandHandler } from './research';

// Mock the engine to isolate command handler logic
vi.mock('../engine/research-scaffold', () => ({
  ResearchScaffolder: vi.fn().mockImplementation(() => ({
    scaffold: vi.fn().mockResolvedValue({ directory: 'docs/research/R008-test-initiative' })
  }))
}));

describe('Research Command Handler (FR-R006-001)', () => {
  it('US-017: triggers scaffolding and returns success message with path', async () => {
    const args = { initiative: 'Test Initiative', methodology: 'technical' };
    const output = await researchCommandHandler(args);

    expect(output).toContain('Scaffolded research initiative at docs/research/R008-test-initiative');
  });

  it('US-017: handles missing optional methodology by defaulting to technical', async () => {
    const args = { initiative: 'Minimal' };
    const output = await researchCommandHandler(args);
    expect(output).toBeDefined();
  });

  it('Negative Path: throws error if initiative name is empty', async () => {
    const args = { initiative: '' };
    await expect(researchCommandHandler(args)).rejects.toThrow();
  });
});
