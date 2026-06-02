import { describe, it, expect, vi } from 'vitest';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';

// We import commands to verify their WorkflowRuntime integration
import { generateTests } from './tests-generate.js';
import { specifyCommand } from './specify.js';
import { definePlanCommand } from './define-plan.js';
import { generateTasks } from './tasks-generate.js';

// SKIPPED: These tests import non-existent standalone function exports.
// The commands export Commander `Command` objects, not callable functions.
// P12 ship agent wrote these against a wrong API surface.
// TODO: Rewrite to test via Commander parseAsync or mock WorkflowRuntime directly.
describe.skip('FR-028: define subcommands quiet output', () => {
  it('US-026: define tests passes quiet: true and tolerant: true to WorkflowRuntime', async () => {
    const executeSpy = vi.spyOn(WorkflowRuntime.prototype, 'executeWorkflow').mockResolvedValue({
      success: true,
      intent: []
    });

    await generateTests('003', { force: true });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        quiet: true,
        tolerant: true
      })
    );
  });

  it('US-026: define spec passes quiet: true to WorkflowRuntime', async () => {
    const executeSpy = vi.spyOn(WorkflowRuntime.prototype, 'executeWorkflow').mockResolvedValue({ success: true, intent: [] });
    await specifyCommand('001');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });

  it('US-026: define plan passes quiet: true to WorkflowRuntime', async () => {
    const executeSpy = vi.spyOn(WorkflowRuntime.prototype, 'executeWorkflow').mockResolvedValue({ success: true, intent: [] });
    await definePlanCommand('001');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });

  it('US-026: define tasks passes quiet: true to WorkflowRuntime', async () => {
    const executeSpy = vi.spyOn(WorkflowRuntime.prototype, 'executeWorkflow').mockResolvedValue({ success: true, intent: [] });
    await generateTasks('001');
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });
});

describe.skip('TC-008: Quiet agent output', () => {
  it('US-026: tests-generate command interprets synthetic success as exit 0', async () => {
    vi.spyOn(WorkflowRuntime.prototype, 'executeWorkflow').mockResolvedValue({
      success: true,
      synthetic: true,
      intent: []
    } as any);

    const result = await generateTests('003', { force: true });
    expect(result?.exitCode ?? 0).toBe(0);
  });
});
