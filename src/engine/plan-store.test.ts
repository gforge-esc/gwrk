/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../db/plan.js';
import { PlanStore } from './plan-store.js';

vi.mock('../db/plan.js', () => ({
  insertFeature: vi.fn(),
  insertPhase: vi.fn(),
  insertEdge: vi.fn(),
  getFeature: vi.fn(),
  getPhase: vi.fn(),
  deleteFeature: vi.fn(),
  deletePhase: vi.fn(),
  deleteEdge: vi.fn(),
  updateFeatureStatus: vi.fn(),
  updateFeatureName: vi.fn(),
  listFeatures: vi.fn(() => []),
  listPhases: vi.fn(() => []),
  listAllEdges: vi.fn(() => []),
  isPlanEmpty: vi.fn(() => true),
  isPlanEmptyTrue: vi.fn(() => true),
  getShippedPhases: vi.fn(() => new Set<string>()),
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

  it('FR-017: should init from specs directory without clobbering existing features', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      { featureId: 'F1', level: 1, status: 'SPECIFIED', hasSpec: true, hasPlan: false, hasTasks: false, spTotal: 0, phases: [] }
    ]);
    
    vi.mocked(db.getFeature).mockReturnValue({ id: 'F1', name: 'Existing', status: 'DONE', sp_total: 0 });
    
    const report = store.initFromSpecs('/mock/specs');
    expect(report.added).not.toContain('F1');
    expect(report.skipped).toContain('F1');
    expect(db.insertFeature).not.toHaveBeenCalled();
  });

  it('FR-017: should insert phases from scanner results during init', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      {
        featureId: 'feat-a', level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false, spTotal: 0,
        phases: [
          { number: 1, title: 'Foundation' },
          { number: 2, title: 'Integration' },
        ],
      }
    ]);
    
    vi.mocked(db.getFeature).mockReturnValue(undefined);
    vi.mocked(db.getPhase).mockReturnValue(undefined);
    
    const report = store.initFromSpecs('/mock/specs');
    expect(report.added).toContain('feat-a');
    expect(report.phasesInserted).toBe(2);
    expect(db.insertPhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat-a/phase-01', feature_id: 'feat-a', name: 'Foundation', status: 'PLANNED', seq: 1 }),
      "test-project",
    );
    expect(db.insertPhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat-a/phase-02', feature_id: 'feat-a', name: 'Integration', status: 'PLANNED', seq: 2 }),
      "test-project",
    );
  });

  it('FR-017: should enrich phase status from ship runs', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      {
        featureId: 'feat-b', level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false, spTotal: 0,
        phases: [
          { number: 1, title: 'Foundation' },
          { number: 2, title: 'Polish' },
        ],
      }
    ]);
    
    vi.mocked(db.getFeature).mockReturnValue(undefined);
    vi.mocked(db.getPhase).mockReturnValue(undefined);
    // Phase 1 has been shipped, phase 2 has not
    vi.mocked(db.getShippedPhases).mockReturnValue(new Set(['feat-b:phase-01']));
    
    store.initFromSpecs('/mock/specs');
    expect(db.insertPhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat-b/phase-01', status: 'SHIPPED' }),
      "test-project",
    );
    expect(db.insertPhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat-b/phase-02', status: 'PLANNED' }),
      "test-project",
    );
  });

  it('FR-017: should not clobber existing phases on re-init', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      {
        featureId: 'feat-c', level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false, spTotal: 0,
        phases: [
          { number: 1, title: 'Foundation' },
          { number: 2, title: 'New Phase' },
        ],
      }
    ]);
    
    vi.mocked(db.getFeature).mockReturnValue({ id: 'feat-c', name: 'feat-c', status: 'DEFINED', sp_total: 0 });
    // Phase 1 already exists in DB, phase 2 does not
    vi.mocked(db.getPhase)
      .mockReturnValueOnce({ id: 'feat-c/phase-01', feature_id: 'feat-c', name: 'Foundation', status: 'SHIPPED', health: 'CLEAN', sp_estimate: 5, seq: 1 })
      .mockReturnValueOnce(undefined);
    
    const report = store.initFromSpecs('/mock/specs');
    expect(report.phasesInserted).toBe(1); // Only phase-02
    expect(db.insertPhase).toHaveBeenCalledTimes(1);
    expect(db.insertPhase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'feat-c/phase-02', name: 'New Phase' }),
      "test-project",
    );
  });

  it('FR-017: should prune ghost features with no specs/ directory', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      { featureId: 'feat-real', level: 1, status: 'SPECIFIED', hasSpec: true, hasPlan: false, hasTasks: false, spTotal: 0, phases: [] }
    ]);

    // DB has a ghost feature that no longer exists on disk
    vi.mocked(db.listFeatures).mockReturnValue([
      { id: 'feat-real', name: 'Real', status: 'SPECIFIED', sp_total: 0 },
      { id: 'ghost-099', name: 'Ghost', status: 'SPECIFIED', sp_total: 0 },
      { id: 'F000', name: 'Extraction', status: 'DONE', sp_total: 0 },
    ]);
    vi.mocked(db.getFeature).mockReturnValue({ id: 'feat-real', name: 'Real', status: 'SPECIFIED', sp_total: 0 });

    const report = store.initFromSpecs('/mock/specs');
    expect(report.pruned).toContain('ghost-099');
    expect(report.pruned).toContain('F000');
    expect(report.pruned).not.toContain('feat-real');
    expect(db.deleteFeature).toHaveBeenCalledWith('ghost-099', 'test-project');
    expect(db.deleteFeature).toHaveBeenCalledWith('F000', 'test-project');
  });

  it('FR-017: should reconcile feature status when all phases are shipped', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      {
        featureId: 'feat-done', level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false, spTotal: 0,
        phases: [{ number: 1, title: 'Phase 1' }, { number: 2, title: 'Phase 2' }],
      }
    ]);

    // Feature exists with wrong status
    vi.mocked(db.getFeature).mockReturnValue({ id: 'feat-done', name: 'feat-done', status: 'DEFINED', sp_total: 0 });
    vi.mocked(db.getPhase).mockReturnValue(undefined);
    // All phases shipped via runs
    vi.mocked(db.getShippedPhases).mockReturnValue(new Set(['feat-done:phase-01', 'feat-done:phase-02']));
    // After insertion, listPhases returns the shipped phases
    vi.mocked(db.listPhases).mockReturnValue([
      { id: 'feat-done/phase-01', feature_id: 'feat-done', name: 'Phase 1', status: 'SHIPPED', health: 'CLEAN', sp_estimate: 0, seq: 1 },
      { id: 'feat-done/phase-02', feature_id: 'feat-done', name: 'Phase 2', status: 'SHIPPED', health: 'CLEAN', sp_estimate: 0, seq: 2 },
    ]);

    const report = store.initFromSpecs('/mock/specs');
    expect(report.reconciled).toContainEqual('feat-done: DEFINED → SHIPPED');
    expect(db.updateFeatureStatus).toHaveBeenCalledWith(
      'feat-done', 'SHIPPED', 'test-project',
    );
  });

  it('FR-017: should set IN_PROGRESS when some phases are shipped', () => {
    vi.spyOn(store, 'scanReadiness').mockReturnValue([
      {
        featureId: 'feat-wip', level: 2, status: 'DEFINED', hasSpec: true, hasPlan: true, hasTasks: false, spTotal: 0,
        phases: [{ number: 1, title: 'Done' }, { number: 2, title: 'Todo' }],
      }
    ]);

    vi.mocked(db.getFeature).mockReturnValue({ id: 'feat-wip', name: 'feat-wip', status: 'DEFINED', sp_total: 0 });
    vi.mocked(db.getPhase).mockReturnValue(undefined);
    vi.mocked(db.getShippedPhases).mockReturnValue(new Set(['feat-wip:phase-01']));
    vi.mocked(db.listPhases).mockReturnValue([
      { id: 'feat-wip/phase-01', feature_id: 'feat-wip', name: 'Done', status: 'SHIPPED', health: 'CLEAN', sp_estimate: 0, seq: 1 },
      { id: 'feat-wip/phase-02', feature_id: 'feat-wip', name: 'Todo', status: 'PLANNED', health: 'CLEAN', sp_estimate: 0, seq: 2 },
    ]);

    const report = store.initFromSpecs('/mock/specs');
    expect(report.reconciled).toContainEqual('feat-wip: DEFINED → IN_PROGRESS');
    expect(db.updateFeatureStatus).toHaveBeenCalledWith(
      'feat-wip', 'IN_PROGRESS', 'test-project',
    );
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
    expect(md).toContain('### Feature F1 — Feat 1 ✅');
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