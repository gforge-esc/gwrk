import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent } from '../utils/agent.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('FR-L25-008 & FR-ADR009-001: WorkflowRuntime MUST dynamically inject project knowledge documents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-019: Given .gwrk/ontology/domain.md exists, When a workflow is dispatched, Then domain.md content is injected', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('MOCKED_DOMAIN_CONTENT');
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const result = await dispatchToAgent({ intent: 'test' } as any);
    expect(result).toContain('<domain_ontology>');
    expect(result).toContain('MOCKED_DOMAIN_CONTENT');
  });

  it('TC-013 & FR-ADR009-001: Domain ontology MUST be injected before information hierarchy and UX posture', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const pathStr = path.toString();
      if (pathStr.includes('domain.md')) return 'ONTOLOGY_CONTENT';
      if (pathStr.includes('hierarchy.md')) return 'HIERARCHY_CONTENT';
      if (pathStr.includes('ux-posture.md')) return 'UX_POSTURE_CONTENT';
      return '';
    });

    const result = await dispatchToAgent({ intent: 'test' } as any);
    
    const ontologyIdx = result.indexOf('ONTOLOGY_CONTENT');
    const hierarchyIdx = result.indexOf('HIERARCHY_CONTENT');
    const uxPostureIdx = result.indexOf('UX_POSTURE_CONTENT');

    expect(ontologyIdx).not.toBe(-1);
    expect(hierarchyIdx).not.toBe(-1);
    expect(uxPostureIdx).not.toBe(-1);
    
    expect(ontologyIdx).toBeLessThan(hierarchyIdx);
    expect(hierarchyIdx).toBeLessThan(uxPostureIdx);
  });

  it('Negative path: Should not throw and skip injection if grounding documents are missing', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    
    const result = await dispatchToAgent({ intent: 'test' } as any);
    expect(result).not.toContain('<domain_ontology>');
    expect(result).not.toContain('ONTOLOGY_CONTENT');
  });
});
