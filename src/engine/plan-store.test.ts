import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore - Module does not exist yet (RED)
import { PlanStore } from './plan-store.js';

describe('src/engine/plan-store.ts (FR-013/017)', () => {
  let store: any;

  beforeEach(() => {
    store = new PlanStore();
  });

  it('FR-013: should seed from parsed markdown payload', () => {
    const payload = {
      features: [{ id: 'F1', name: 'Feat 1', status: 'PLANNED', sp_total: 10 }],
      phases: [{ id: 'F1-P1', feature_id: 'F1', name: 'Phase 1', status: 'PLANNED', seq: 1 }],
      edges: [{ from_id: 'F0', to_id: 'F1', edge_type: 'DEPENDS_ON' }]
    };
    
    store.seedPlan(payload.features, payload.phases, payload.edges);
    const status = store.getPlanStatus();
    expect(status.features).toContainEqual(expect.objectContaining(payload.features[0]));
  });

  it('FR-017: should init from specs directory without clobbering', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      { featureId: 'F1', level: 1, status: 'SPECIFIED', hasSpec: true, hasPlan: false, hasTasks: false, spTotal: null }
    ]);
    
    store.seedPlan([{ id: 'F1', name: 'Existing', status: 'DONE', sp_total: 0 }], [], []);
    
    const report = store.initFromSpecs('/mock/specs');
    expect(report.added).not.toContain('F1');
    expect(report.skipped).toContain('F1');
    
    const status = store.getPlanStatus();
    expect(status.features.find(f => f.id === 'F1').status).toBe('DONE');
  });

  it('FR-019: should detect empty graph', () => {
    expect(store.isEmpty()).toBe(true);
    store.seedPlan([{ id: 'F1', name: 'F1', status: 'PLANNED', sp_total: 0 }], [], []);
    expect(store.isEmpty()).toBe(false);
  });
});