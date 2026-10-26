/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from 'vitest';
import { PlanRenderer } from './plan-renderer.js';
import type { PlanSolver } from './plan-solver.js';

describe('PlanRenderer', () => {
  const mockFeatures = [
    { id: 'F0', name: 'Extraction', status: 'DONE', sp_total: 3 },
    { id: 'F1', name: 'CLI Core', status: 'SHIPPED', sp_total: 25 },
  ];
  const mockPhases = [
    { id: 'F1-P1', feature_id: 'F1', name: 'Bootstrap', status: 'DONE', seq: 1, sp_estimate: 10 },
    { id: 'F1-P2', feature_id: 'F1', name: 'Commands', status: 'SHIPPED', seq: 2, sp_estimate: 15 },
  ];
  const mockEdges = [
    { from_id: 'F0', to_id: 'F1', edge_type: 'DEPENDS_ON' },
  ];

  const mockSolver = {
    getCriticalPath: vi.fn().mockReturnValue({
      path: mockPhases,
      warnings: [],
      slackMap: {}
    }),
    getTopologicalWaves: vi.fn().mockReturnValue([
      [mockPhases[0]],
      [mockPhases[1]]
    ]),
  } as unknown as PlanSolver;

  it('should render all sections of the build plan', () => {
    const renderer = new PlanRenderer(mockFeatures, mockPhases, mockEdges, mockSolver);
    const md = renderer.render();

    expect(md).toContain('# 000 Build Plan — gwrk');
    expect(md).toContain('## Terminology');
    expect(md).toContain('## Dependency Graph');
    expect(md).toContain('## Critical Path');
    expect(md).toContain('## Features');
    expect(md).toContain('## Wave Strategy');
    expect(md).toContain('## Estimated Effort');
    expect(md).toContain('## Open Questions');
    expect(md).toContain('## Changelog');
  });

  it('should render Mermaid graph with correct labels and styles', () => {
    const renderer = new PlanRenderer(mockFeatures, mockPhases, mockEdges, mockSolver);
    const md = renderer.render();

    expect(md).toContain('F0["F0: Extraction ✅"] --> F1["F1: CLI Core ✅"]');
    expect(md).toContain('style F0 fill:#22cc22,stroke:#118811,color:#fff');
    expect(md).toContain('style F1 fill:#22cc22,stroke:#118811,color:#fff');
  });

  it('should render Gantt chart for critical path', () => {
    const renderer = new PlanRenderer(mockFeatures, mockPhases, mockEdges, mockSolver);
    const md = renderer.render();

    expect(md).toContain('gantt');
    expect(md).toContain('Bootstrap                 :done, F1_P1, 2026-01-01, 10d');
    expect(md).toContain('Commands                  :done, F1_P2, after F1_P1, 15d');
  });

  it('should render features and phases table', () => {
    const renderer = new PlanRenderer(mockFeatures, mockPhases, mockEdges, mockSolver);
    const md = renderer.render();

    expect(md).toContain('### Feature F0 — Extraction ✅');
    expect(md).toContain('### Feature F1 — CLI Core ✅');
    expect(md).toContain('| 1 | Bootstrap | DONE ✅ | 10 |');
    expect(md).toContain('| 2 | Commands | SHIPPED ✅ | 15 |'); // SHIPPED also gets ✅ in my current PlanRenderer logic
  });
});

/**
 * 029 Decision Records — RED tests for TR-012 (FR-016).
 *
 * @phase 07
 * @status active
 *
 * `plan-renderer.ts:38` enumerates ADR-001 through ADR-006 and stops there.
 * One index link replaces the enumeration. Per the 023 plan-format contract
 * only the HEADER changes — no phase, task or `Requirements Addressed:` grammar
 * is touched, which the last assertion here pins.
 */
describe('029 FR-016: the build plan header links the decision index (US-007)', () => {
  const mockFeatures = [{ id: 'F0', name: 'Extraction', status: 'DONE', sp_total: 3 }];
  const mockPhases = [
    { id: 'F0-P1', feature_id: 'F0', name: 'Bootstrap', status: 'DONE', seq: 1, sp_estimate: 10 },
  ];
  const mockSolver = {
    getCriticalPath: vi.fn().mockReturnValue({ path: mockPhases, warnings: [], slackMap: {} }),
    getTopologicalWaves: vi.fn().mockReturnValue([[mockPhases[0]]]),
  } as unknown as PlanSolver;

  function render(): string {
    return new PlanRenderer(mockFeatures, mockPhases, [], mockSolver).render();
  }

  it('FR-016: links the decision index instead of enumerating ADRs', () => {
    const md = render();

    expect(md).toContain('.gwrk/decisions/index.md');
    // No per-ADR enumeration: the list that stopped at ADR-006 is gone.
    expect(md).not.toMatch(/\[ADR-00\d\]\(docs\/decisions\//);
    expect((md.match(/ADR-00\d/g) ?? []).length).toBe(0);
  });

  it('FR-016: carries no dead file:// link', () => {
    expect(render()).not.toContain('file:///Users/gonzo');
  });

  it('FR-016: moves no other header field (023 plan-format contract)', () => {
    const md = render();

    expect(md).toContain('# 000 Build Plan — gwrk');
    expect(md).toMatch(/^> \*\*Status:\*\* Authoritative · \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/m);
    expect(md).toMatch(/^> \*\*Anchored to:\*\*/m);
    expect(md).toMatch(/^> \*\*Decisions:\*\*/m);
  });
});
