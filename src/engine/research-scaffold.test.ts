/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResearchScaffolder } from './research-scaffold';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('ResearchScaffolder (FR-R006-001)', () => {
  const scaffolder = new ResearchScaffolder();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('TR-011 / US-017: scaffolds a new research directory with correct R0XX numbering', async () => {
    // Mock existing directories to determine next number (e.g., R001, R002 -> R003)
    (fs.readdir as any).mockResolvedValue(['R001-existing-initiative', 'R002-other-research']);

    const result = await scaffolder.scaffold('New Research');

    // Expect R003 based on existing R002
    expect(result.directory).toBe('docs/research/R003-new-research');
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('docs/research/R003-new-research'),
      { recursive: true }
    );
  });

  it('FR-R006-001: slugifies the initiative name correctly', async () => {
    (fs.readdir as any).mockResolvedValue([]);
    const result = await scaffolder.scaffold('My Awesome Initiative!!!');
    // Should handle casing and special characters
    expect(result.directory).toMatch(/R001-my-awesome-initiative$/i);
  });

  it('FR-R006-001: creates brief.md with default technical methodology', async () => {
    (fs.readdir as any).mockResolvedValue([]);
    await scaffolder.scaffold('Test');

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('brief.md'),
      expect.stringContaining('methodology: technical')
    );
  });

  it('FR-R006-001: creates brief.md with custom methodology from options', async () => {
    (fs.readdir as any).mockResolvedValue([]);
    await scaffolder.scaffold('Test', { methodology: 'jtbd' });

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('brief.md'),
      expect.stringContaining('methodology: jtbd')
    );
  });

  it('FR-R006-001: ensures brief.md contains YAML frontmatter structure', async () => {
    (fs.readdir as any).mockResolvedValue([]);
    await scaffolder.scaffold('Architecture Audit');

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('brief.md'),
      expect.stringMatching(/^---\n[\s\S]*?initiative: Architecture Audit[\s\S]*?---\n/)
    );
  });
});
