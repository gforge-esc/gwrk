import { describe, it, expect } from 'vitest';
// @ts-ignore - Function does not exist yet (RED)
import { computeForecastFromLOC } from './compression.js';

describe('FR-016: LOC-Derived SP Fallback', () => {
  it('US-001: should compute Story Points from LOC using language rates', () => {
    const loc = 100;
    const language = 'TS'; // 50 LOC/SP
    const result = computeForecastFromLOC(loc, language);
    expect(result.sp).toBe(2);
  });

  it('should handle Rust specific rate (35 LOC/SP)', () => {
    const loc = 70;
    const language = 'Rust';
    const result = computeForecastFromLOC(loc, language);
    expect(result.sp).toBe(2);
  });

  it('TC-001: should be deterministic and round to 2 decimal places', () => {
    const loc = 75;
    const language = 'TS'; // 50 LOC/SP -> 1.5 SP
    const result = computeForecastFromLOC(loc, language);
    expect(result.sp).toBe(1.5);
    expect(typeof result.sp).toBe('number');
  });

  it('should return a result with sp and confidence fields', () => {
    const result = computeForecastFromLOC(100, 'TS');
    expect(result).toHaveProperty('sp');
    expect(result).toHaveProperty('confidence');
  });
});
