/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRuntime, extractJsonFromOutput, wouldShrinkExistingFile } from './workflow-runtime.js';
import * as conditioner from '../engine/prompt-conditioner.js';
import * as detector from '../engine/profile-detector.js';
import * as agentUtils from '../utils/agent.js';
import { PluginLoader } from './loader.js';
import fs from 'node:fs/promises';
import { execSync } from "node:child_process";

vi.mock('../engine/prompt-conditioner.js');
vi.mock('../engine/profile-detector.js');
vi.mock('../utils/agent.js');
vi.mock('./loader.js');
vi.mock('node:fs/promises');
vi.mock('node:child_process');

describe('WorkflowRuntime Phase 13: Project Awareness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TR-033: should call detectProfile and conditionPrompt during executeWorkflow', async () => {
    const mockManifest = {
      name: 'test-workflow',
      type: 'workflow',
      outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } }
    };
    
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: mockManifest as any,
      path: '/mock/plugin/path'
    });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    
    const mockProfile = { type: 'gwrk-native', stack: {}, layout: 'flat' };
    vi.mocked(detector.detectProfile).mockResolvedValue(mockProfile as any);
    vi.mocked(conditioner.conditionPrompt).mockReturnValue('<conditioned># Test Prompt</conditioned>');
    
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ summary: 'Done', intents: [] }),
      stderr: '',
      durationS: 1
    });

    const runtime = new WorkflowRuntime();
    await runtime.executeWorkflow('test-workflow', 'input data', { projectRoot: '/mock/root' });

    expect(detector.detectProfile).toHaveBeenCalledWith('/mock/root');
    expect(conditioner.conditionPrompt).toHaveBeenCalledWith('# Test Prompt', mockProfile);
    expect(agentUtils.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('<conditioned># Test Prompt</conditioned>')
    }));
  });
});

describe('WorkflowRuntime tolerant JSON extraction', () => {
  it('should extract JSON from fenced blocks', () => {
    const stdout = 'Some prose\n```json\n{"summary": "test", "intents": []}\n```\nMore prose';
    const result = extractJsonFromOutput(stdout);
    expect(result).toEqual({ summary: 'test', intents: [] });
  });

  it('should extract bare JSON from the end of output', () => {
    const stdout = 'Prose before\n{"summary": "bare", "intents": []}\nProse after';
    const result = extractJsonFromOutput(stdout);
    expect(result).toEqual({ summary: 'bare', intents: [] });
  });

  it('wouldShrinkExistingFile guards native-write clobbers without blocking legit writes', () => {
    // New file → allow (nothing to clobber).
    expect(wouldShrinkExistingFile(null, 'anything')).toBe(false);
    // Existing full file vs abbreviated/placeholder intent → skip the write.
    const full = 'x'.repeat(15000);
    expect(wouldShrinkExistingFile(full, '<full report — written to disk>')).toBe(true);
    // Empty overwrite of an existing file → skip.
    expect(wouldShrinkExistingFile(full, '')).toBe(true);
    // Growth or equal-size rewrite → allow.
    expect(wouldShrinkExistingFile('short', 'a much longer replacement body')).toBe(false);
    expect(wouldShrinkExistingFile('same', 'same')).toBe(false);
  });

  it('unwraps Claude --output-format json envelope and extracts the inner payload', () => {
    // Claude wraps the answer (prose + fenced JSON) in a `result` string.
    const inner = 'Here is the report.\n```json\n{"summary": "env", "intents": []}\n```';
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: inner,
      session_id: 'abc',
    });
    const result = extractJsonFromOutput(envelope);
    expect(result).toEqual({ summary: 'env', intents: [] });
  });

  it('throws (not silently returns the wrapper) when a result envelope carries no contract', () => {
    // Regression: when the agent spends its turn asking questions instead of
    // emitting the contract, the `result` string has no JSON. The envelope
    // unwrap must propagate that failure — NOT fall back to brace-scanning the
    // wrapper and returning {type:"result",…}, which has no summary/intents and
    // masks the real failure as a misleading "missing property 'summary'".
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Q1. Scheduler mechanism? Q2. Run granularity? Please advise.',
      session_id: 'abc',
    });
    expect(() => extractJsonFromOutput(envelope)).toThrow(/Expected JSON object/);
  });

  it('TR-029: should return synthetic success for prose output if exitCode is 0 and tolerant mode is on', async () => {
    const mockManifest = {
      name: 'test-workflow',
      type: 'workflow',
      outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } }
    };
    
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: mockManifest as any,
      path: '/mock/plugin/path'
    });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: 'I did the work natively, here is some prose.',
      stderr: '',
      durationS: 1
    });

    const runtime = new WorkflowRuntime();
    const result = await runtime.executeWorkflow('test-workflow', 'input data', { 
      projectRoot: '/mock/root',
      tolerant: true
    });

    expect(result.summary).toContain('Agent completed successfully (native execution, no JSON intents)');
    expect(result.intents).toEqual([]);
  });

  it('TR-029: should return synthetic success if exitCode is 0 and artifacts are detected (even if tolerant is off)', async () => {
    const mockManifest = {
      name: 'test-workflow',
      type: 'workflow',
      outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } }
    };
    
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: mockManifest as any,
      path: '/mock/plugin/path'
    });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: 'I did the work natively and committed it.',
      stderr: '',
      durationS: 1
    });

    vi.mocked(execSync).mockReturnValue(Buffer.from('M  src/new-file.ts'));

    const runtime = new WorkflowRuntime();
    const result = await runtime.executeWorkflow('test-workflow', 'input data', { 
      projectRoot: '/mock/root',
      tolerant: false
    });

    expect(result.summary).toContain('Agent completed successfully (native execution, no JSON intents)');
    expect(execSync).toHaveBeenCalledWith("git status --porcelain", expect.anything());
  });

  it('recovers native success when Claude exhausts structured-output retries but wrote artifacts (exit 1)', async () => {
    const mockManifest = {
      name: 'test-workflow', type: 'workflow',
      outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } }
    };
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({ manifest: mockManifest as any, path: '/mock/plugin/path' });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({ type: 'result', subtype: 'error_max_structured_output_retries', is_error: true }),
      stderr: 'Warning: no stdin data received in 3s',
      durationS: 1
    });
    vi.mocked(execSync).mockReturnValue(Buffer.from(' M specs/001/plan.md'));

    const runtime = new WorkflowRuntime();
    const result = await runtime.executeWorkflow('test-workflow', 'input data', { projectRoot: '/mock/root' });

    expect(result.summary).toContain('native execution');
    expect(result.intents).toEqual([]);
  });

  it('still fails on structured-output exhaustion when NO artifacts were written', async () => {
    const mockManifest = {
      name: 'test-workflow', type: 'workflow',
      outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } }
    };
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({ manifest: mockManifest as any, path: '/mock/plugin/path' });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 1,
      stdout: JSON.stringify({ type: 'result', subtype: 'error_max_structured_output_retries', is_error: true }),
      stderr: '',
      durationS: 1
    });
    vi.mocked(execSync).mockReturnValue(Buffer.from('')); // clean tree — nothing written

    const runtime = new WorkflowRuntime();
    await expect(
      runtime.executeWorkflow('test-workflow', 'input data', { projectRoot: '/mock/root' })
    ).rejects.toThrow(/exit code 1/);
  });

  it('passes outputSchema to the agent only when the manifest sets enforceOutputSchema', async () => {
    const outputSchema = { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } };
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'enforced-wf', type: 'workflow', enforceOutputSchema: true, outputSchema } as any,
      path: '/mock/plugin/path'
    });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ summary: 'ok', intents: [] }), stderr: '', durationS: 1 });

    const runtime = new WorkflowRuntime();
    await runtime.executeWorkflow('enforced-wf', 'input', { projectRoot: '/mock/root' });

    expect(agentUtils.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ outputSchema }));
  });

  it('does NOT pass outputSchema when the manifest does not enforce it (content-heavy workflows)', async () => {
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'plan-wf', type: 'workflow', outputSchema: { type: 'object', required: ['summary', 'intents'], properties: { summary: { type: 'string' }, intents: { type: 'array' } } } } as any,
      path: '/mock/plugin/path'
    });
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ summary: 'ok', intents: [] }), stderr: '', durationS: 1 });

    const runtime = new WorkflowRuntime();
    await runtime.executeWorkflow('plan-wf', 'input', { projectRoot: '/mock/root' });

    expect(agentUtils.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ outputSchema: undefined }));
  });
});
