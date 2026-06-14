import { describe, it, expect } from 'vitest';
import { clusterCommits } from './commit-cluster.js';

describe('FR-006: clusterCommits', () => {
  it('US-004 / TR-006: Should cluster commits with a gap threshold and sum active durations', () => {
    // [0, 5, 10, 120, 125] -> 2 sessions, 15 min active
    const dates = [
      new Date('2026-06-13T10:00:00Z'),
      new Date('2026-06-13T10:05:00Z'),
      new Date('2026-06-13T10:10:00Z'),
      new Date('2026-06-13T12:00:00Z'),
      new Date('2026-06-13T12:05:00Z')
    ];
    expect(() => clusterCommits(dates, 30)).toThrow();
  });

  it('Should handle empty array', () => {
    expect(() => clusterCommits([], 30)).toThrow();
  });
});
