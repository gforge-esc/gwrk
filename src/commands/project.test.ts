import { describe, it, expect } from 'vitest';
// @ts-ignore - Stub may be incomplete in source
import { ProjectCommand } from './project';

describe('US-023: Project Info Toolchain Reporting', () => {
  it('FR-015: surfaces toolchain data in JSON output', async () => {
    // Note: ProjectCommand must be updated to support toolchain output
    const cmd = new ProjectCommand();
    const output = await (cmd as any).getInfo({ format: 'json', root: '.' });
    const json = JSON.parse(output);
    
    expect(json).toHaveProperty('toolchain');
    expect(json.toolchain).toHaveProperty('primary');
  });
});