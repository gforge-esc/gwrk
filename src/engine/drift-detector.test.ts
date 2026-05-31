import { describe, it, expect } from 'vitest';
import { getDriftArtifacts } from './drift-detector.js';

describe('FR-P11-004: drift-detector.ts', () => {
  it('TR-P11-004: should not include .agents/ in drift checks', () => {
    // This test ensures that the .agents/ directory is no longer considered 
    // a tracked artifact for drift detection.
    // It will fail if '.agents/' is still returned in the artifact list.
    const artifacts = getDriftArtifacts();
    expect(artifacts).not.toContain('.agents/');
  });
});
