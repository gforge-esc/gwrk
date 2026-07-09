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
