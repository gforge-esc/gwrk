/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve directory for co-located PROMPT.md
const __dirname = join(fileURLToPath(import.meta.url), '..');
const PROMPT_PATH = join(__dirname, 'PROMPT.md');

describe('US-024 / FR-L25-013: Mandatory Context Gathering', () => {
  it('FR-L25-013: Preamble MUST contain "gwrk project info" command (US-024)', () => {
    const content = readFileSync(PROMPT_PATH, 'utf-8');
    // Acceptance: cat PROMPT.md | grep "gwrk project info"
    expect(content).toContain('gwrk project info');
  });

  it('FR-L25-013: Preamble MUST contain "gwrk project discover" command (US-024)', () => {
    const content = readFileSync(PROMPT_PATH, 'utf-8');
    expect(content).toContain('gwrk project discover');
  });

  it('FR-L25-001 (Boundary): Prompt file must be a non-empty markdown file', () => {
    const content = readFileSync(PROMPT_PATH, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
    expect(content.startsWith('#')).toBe(true);
  });
});
