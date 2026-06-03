import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToAgent } from '../utils/agent.js';
import { AgentBackendRegistry } from '../plugins/agent-registry.js';
import fs from 'node:fs';

// Mock the dependencies
vi.mock('../plugins/agent-registry.js');
vi.mock('../plugins/loader.js');
vi.mock('node:fs');
vi.mock('../db/plugins.js');
vi.mock('../utils/project-id.js');
vi.mock('../plugins/skill-runtime.js');

describe('FR-L25-008 & FR-ADR009-001: WorkflowRuntime MUST dynamically inject project knowledge documents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    // Direct mock implementation
    vi.mocked(AgentBackendRegistry).mockImplementation(() => ({
      getAgentBackend: vi.fn().mockResolvedValue({
        dispatch: vi.fn().mockResolvedValue({
          command: 'test-cmd',
          args: [],
          stdin: 'ORIGINAL_PROMPT'
        }),
        parseResult: vi.fn().mockReturnValue({ exitCode: 0, stdout: 'Success', stderr: '' })
      })
    } as any));

    (fs.createWriteStream as any).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn()
    });
    (fs.mkdirSync as any).mockReturnValue(undefined);
    (fs.existsSync as any).mockReturnValue(false);
  });

  it('US-019: Given .gwrk/ontology/domain.md exists, When a workflow is dispatched, Then domain.md content is injected', async () => {
    (fs.existsSync as any).mockImplementation((p: string) => p.includes('domain.md'));
    (fs.readFileSync as any).mockReturnValue('MOCKED_DOMAIN_CONTENT');

    const result = await dispatchToAgent({ intent: 'test', dryRun: true } as any);
    
    expect(result.stdout).toContain('<domain_ontology>');
    expect(result.stdout).toContain('MOCKED_DOMAIN_CONTENT');
    expect(result.stdout).toContain('ORIGINAL_PROMPT');
  });

  it('TC-013 & FR-ADR009-001: Domain ontology MUST be injected before information hierarchy and UX posture', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.includes('domain.md')) return 'ONTOLOGY_CONTENT';
      if (path.includes('hierarchy.md')) return 'HIERARCHY_CONTENT';
      if (path.includes('ux-posture.md')) return 'UX_POSTURE_CONTENT';
      return '';
    });

    const result = await dispatchToAgent({ intent: 'test', dryRun: true } as any);
    const stdin = result.stdout;
    
    const ontologyIdx = stdin.indexOf('ONTOLOGY_CONTENT');
    const hierarchyIdx = stdin.indexOf('HIERARCHY_CONTENT');
    const uxPostureIdx = stdin.indexOf('UX_POSTURE_CONTENT');

    expect(ontologyIdx).not.toBe(-1);
    expect(hierarchyIdx).not.toBe(-1);
    expect(uxPostureIdx).not.toBe(-1);
    
    expect(ontologyIdx).toBeLessThan(hierarchyIdx);
    expect(hierarchyIdx).toBeLessThan(uxPostureIdx);
  });

  it('Negative path: Should not throw and skip injection if grounding documents are missing', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    
    const result = await dispatchToAgent({ intent: 'test', dryRun: true } as any);
    expect(result.stdout).not.toContain('<domain_ontology>');
    expect(result.stdout).toContain('ORIGINAL_PROMPT');
  });
});
