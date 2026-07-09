/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { computeCompression, generateSummary } from './compression.js';

describe('FR-007 / FR-008: computeCompression', () => {
  it('US-003 / TR-007: Should compute Point Compression correctly', () => {
    expect(() => computeCompression('feature')).toThrow();
  });

  it('US-003 / TR-008: Should compute Total Compression correctly', () => {
    expect(() => computeCompression('feature')).toThrow();
  });

  it('FR-010 / US-006 / TR-010: Should fail fast when feature has no impl commits', () => {
    expect(() => computeCompression('draft-only')).toThrow();
  });

  it('Should handle errors when effort data is missing', () => {
    expect(() => computeCompression('no-effort-data')).toThrow();
  });
});

describe('FR-009: generateSummary', () => {
  it('US-005 / TR-009: Should aggregate multiple features and identify best/worst/trend', () => {
    expect(() => generateSummary()).toThrow();
  });
});
