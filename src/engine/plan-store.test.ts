import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../db/plan.js';
import { PlanStore } from './plan-store.js';

vi.mock('../db/plan.js', () => ({
  insertFeature: vi.fn(),
  insertPhase: vi.fn(),
  insertEdge: vi.fn(),
  getFeature: vi.fn(),
  getPhase: vi.fn(),
  deletePhase: vi.fn(),
  deleteEdge: vi.fn(),
  listFeatures: vi.fn(() => []),
  listPhases: vi.fn(() => []),
  listAllEdges: vi.fn(() => []),
  isPlanEmpty: vi.fn(() => true),
  isPlanEmptyTrue: vi.fn(() => true),
}));

describe('src/engine/plan-store.ts (FR-013/017)', () => {
  let store: PlanStore;

  beforeEach(() => {
    store = new PlanStore("test-project");
    vi.clearAllMocks();
  });

  it('FR-013: should seed from parsed markdown payload', () => {
    const payload = {
      features: [{ id: 'F1', name: 'Feat 1', status: 'PLANNED', sp_total: 10 }],
      phases: [{ id: 'F1-P1', feature_id: 'F1', name: 'Phase 1', status: 'PLANNED', seq: 1 }],
      edges: [{ from_id: 'F0', to_id: 'F1', edge_type: 'DEPENDS_ON' }]
    };
    
    vi.mocked(db.listFeatures).mockReturnValue(payload.features);
    
    store.seedPlan(payload.features, payload.phases, payload.edges);
    const status = store.getPlanStatus();
    expect(db.insertFeature).toHaveBeenCalledWith(payload.features[0], "test-project");
    expect(status.features).toContainEqual(expect.objectContaining(payload.features[0]));
  });

  it('FR-017: should init from specs directory without clobbering', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      { featureId: 'F1', level: 1, status: 'SPECIFIED', hasSpec: true, hasPlan: false, hasTasks: false, spTotal: 0 }
    ]);
    
    vi.mocked(db.getFeature).mockReturnValue({ id: 'F1', name: 'Existing', status: 'DONE', sp_total: 0 });
    
    const report = store.initFromSpecs('/mock/specs');
    expect(report.added).not.toContain('F1');
    expect(report.skipped).toContain('F1');
    expect(db.insertFeature).not.toHaveBeenCalled();
  });

  it('FR-019: should detect empty graph', () => {
    vi.mocked(db.isPlanEmpty).mockReturnValue(true);
    expect(store.isEmpty()).toBe(true);
    
    vi.mocked(db.isPlanEmpty).mockReturnValue(false);
    expect(store.isEmpty()).toBe(false);
  });

  it('FR-009: should render build plan as markdown', async () => {
    const features = [
      { id: 'F1', name: 'Feat 1', status: 'DONE', sp_total: 10, phases: [
        { id: 'F1-P1', feature_id: 'F1', name: 'P1', status: 'DONE', sp_estimate: 5, seq: 1 }
      ]}
    ];
    const edges = [{ from_id: 'F0', to_id: 'F1', edge_type: 'DEPENDS_ON' }];
    
    vi.mocked(db.listFeatures).mockReturnValue(features);
    vi.mocked(db.listPhases).mockReturnValue(features[0].phases);
    vi.mocked(db.listAllEdges).mockReturnValue(edges);
    
    const md = await store.render();
    expect(md).toContain('# 000 Build Plan — gwrk');
    expect(md).toContain('graph TD');
    expect(md).toContain('F0 --> F1["F1: Feat 1 ✅"]');
    expect(md).toContain('### Feature 1 — Feat 1 ✅');
    expect(md).toContain('| 1 | P1 | DONE ✅ | 5 |');
  });

  describe('Phase 3 Mutations (FR-011)', () => {
    it('should add a feature', () => {
      const feature = { id: 'F2', name: 'Feat 2', status: 'PLANNED', sp_total: 5 };
      store.addFeature(feature);
      expect(db.insertFeature).toHaveBeenCalledWith(feature, "test-project");
    });

    it('should add a phase', () => {
      const phase = { id: 'F2-P1', feature_id: 'F2', name: 'Phase 1', status: 'PLANNED', seq: 1 };
      store.addPhase(phase);
      expect(db.insertPhase).toHaveBeenCalledWith(phase, "test-project");
    });

    it('should update a phase', () => {
      const existing = { id: 'F2-P1', feature_id: 'F2', name: 'Phase 1', status: 'PLANNED', seq: 1 };
      vi.mocked(db.getPhase).mockReturnValue(existing);
      
      store.updatePhase('F2-P1', { status: 'IN_PROGRESS' });
      expect(db.insertPhase).toHaveBeenCalledWith({ ...existing, status: 'IN_PROGRESS' }, "test-project");
    });

    it('should remove a phase', () => {
      store.removePhase('F2-P1');
      expect(db.deletePhase).toHaveBeenCalledWith('F2-P1', "test-project");
    });

    it('should add an edge', () => {
      const edge = { from_id: 'F1', to_id: 'F2', edge_type: 'DEPENDS_ON' };
      store.addEdge(edge);
      expect(db.insertEdge).toHaveBeenCalledWith(edge, "test-project");
    });

    it('should remove an edge', () => {
      store.removeEdge('F1', 'F2', 'DEPENDS_ON');
      expect(db.deleteEdge).toHaveBeenCalledWith('F1', 'F2', 'DEPENDS_ON', "test-project");
    });
  });
});