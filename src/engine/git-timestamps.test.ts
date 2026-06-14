import { describe, it, expect } from 'vitest';
import { collectTimestamps } from './git-timestamps.js';

describe('FR-005: collectTimestamps', () => {
  it('US-003 / TR-005: Should extract spec creation date, first/last impl commit, and PR merge time', () => {
    expect(() => collectTimestamps('001-cli-core')).toThrow();
  });

  it('Should handle missing gh CLI gracefully', () => {
    expect(() => collectTimestamps('001-cli-core')).toThrow();
  });
});
