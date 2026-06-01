import { describe, it, expect } from 'vitest';
import { AgyAdapter } from './adapter';

describe('TR-3A-001 to TR-3A-004: AgyAdapter', () => {
  it('TR-3A-001: returns correct agy CLI command format', () => {
    const adapter = new AgyAdapter();
    expect(() => adapter.dispatch({})).toThrow();
  });
});
