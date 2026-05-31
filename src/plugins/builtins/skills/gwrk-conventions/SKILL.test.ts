import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';

describe('TR-P9-006: GWRK Conventions Content', () => {
  it('contains valid task status enum', () => {
    const content = fs.readFileSync('src/plugins/builtins/skills/gwrk-conventions/SKILL.md', 'utf8');
    // The content uses backticks and commas/lists
    expect(content).toMatch(/`open`|`in_progress`|`completed`|`cancelled`/);
  });
});
