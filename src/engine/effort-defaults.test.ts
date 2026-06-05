import { describe, it, expect } from 'vitest';
// @ts-ignore - Module does not exist yet (RED)
import { EFFORT_DEFAULTS } from './effort-defaults.js';

describe('FR-019: Language-specific LOC rates', () => {
  it('should have correct default rates for supported languages', () => {
    expect(EFFORT_DEFAULTS['TS']).toBe(50);
    expect(EFFORT_DEFAULTS['Rust']).toBe(35);
    expect(EFFORT_DEFAULTS['Python']).toBe(65);
    expect(EFFORT_DEFAULTS['DE']).toBe(25);
  });

  it('should return undefined for unsupported languages', () => {
    // @ts-expect-error - testing invalid input
    expect(EFFORT_DEFAULTS['COBOL']).toBeUndefined();
  });
});
