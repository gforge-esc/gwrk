import { describe, it, expect } from 'vitest';
import { finishRun } from './runs.js';

describe('FR-H03: Finalize SQLite run record', () => {
  it('US-H03: Verify finishRun updates status to merged and sets finished_at (TR-H03)', async () => {
    expect(finishRun).toBeDefined();
    throw new Error('Not implemented');
  });
  
  it('Negative path: throws if run record not found', async () => {
    throw new Error('Not implemented');
  });
});
