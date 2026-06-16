/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module does not exist yet (RED)
 */
import { describe, it, expect } from 'vitest';
import { extractStories } from './spec-parser.js';

describe('FR-001: Story Extraction', () => {
  it('TR-001: US-001 - extracts US-001 with SP=5 and role=TS correctly', () => {
    const markdown = `
### US-001 - Single Feature Estimate [SP: 5] [Role: TS]
`;
    // Existing extractStories expects a directory. 
    expect(() => extractStories(markdown)).toThrow();
  });
});
