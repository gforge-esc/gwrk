import { describe, it, expect } from 'vitest';
/**
 * Module does not exist yet (RED)
 * TR-P11-004: drift-detector.ts Deletion Verification
 */
// @ts-ignore - getDriftArtifacts will be implemented in Phase 11
import { getDriftArtifacts } from './drift-detector.js';

describe('FR-P11-004: drift-detector.ts Deletion Verification', () => {
  it('TR-P11-004: should not include .agents/ in tracked drift artifacts', () => {
    // Phase 11 removes .agents/ from the repo. It should no longer be tracked as a drift artifact.
    // This test is RED until getDriftArtifacts is implemented and returns the updated list.
    const artifacts = getDriftArtifacts();
    expect(artifacts).not.toContain('.agents/');
  });
});
