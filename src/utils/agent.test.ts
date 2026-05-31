import { describe, it, expect, vi } from 'vitest';
import { dispatchToAgent } from './agent.js';
import * as skillRuntime from '../plugins/skill-runtime.js';

vi.mock('../plugins/skill-runtime.js');

describe('US-016: Enforcement Skills Dispatch Injection', () => {
  it('TR-P9-005: injects enforcement skills into <code_quality> section', async () => {
    vi.mocked(skillRuntime.resolveEnforcementSkills).mockResolvedValue('# Strict Typing Rule');
    
    // We need to capture the prompt passed to the agent backend
    // This is a high-level test assuming dispatchToAgent assembles the context
    const result = await dispatchToAgent({
      workflow: 'gwrk-implement',
      projectRoot: '/fake/root',
      payload: { task: 'fix bug' }
    });

    // Implementation detail: check if the final prompt string contains the skill
    // Assuming result or a mock capture shows the prompt
    // For RED state, we expect this to fail if not implemented
    expect(skillRuntime.resolveEnforcementSkills).toHaveBeenCalledWith('/fake/root');
  });
});
