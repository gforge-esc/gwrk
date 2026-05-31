import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

describe('TR-P10-004: Slack Agent Legacy Removal', () => {
  it('contains no hardcoded .agents/workflows/ references', () => {
    const source = fs.readFileSync('src/server/slack-agent.ts', 'utf8');
    expect(source).not.toContain('.agents/workflows/');
  });
});
