import { beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore - Module does not exist yet (RED)
import { insertFeature, getFeature, insertPhase, getPhase, insertEdge, getEdgesForFeature } from './plan.js';
import { db } from './index.js';

describe('src/db/plan.ts (DM-018-001/002/003)', () => {
  beforeEach(() => {
    // Clean tables before each test
    db.exec('DELETE FROM plan_edges');
    db.exec('DELETE FROM plan_phases');
    db.exec('DELETE FROM plan_features');
  });

  it('FR-001: should insert and retrieve a feature', () => {
    const feature = { id: 'F018', name: 'Build Plan Orchestrator', status: 'PLANNED', sp_total: 25 };
    insertFeature(feature);
    const result = getFeature('F018');
    expect(result).toMatchObject(feature);
  });

  it('FR-001: should insert and retrieve a phase', () => {
    insertFeature({ id: 'F018', name: 'Build Plan Orchestrator', status: 'PLANNED', sp_total: 25 });
    const phase = { 
      id: 'F018-P1', 
      feature_id: 'F018', 
      name: 'Foundation', 
      status: 'PLANNED', 
      health: 'CLEAN', 
      sp_estimate: 5,
      seq: 1
    };
    insertPhase(phase);
    const result = getPhase('F018-P1');
    expect(result).toMatchObject(phase);
  });

  it('FR-001: should insert and retrieve edges', () => {
    insertFeature({ id: 'F018', name: 'Feature 1', status: 'PLANNED', sp_total: 0 });
    insertFeature({ id: 'F019', name: 'Feature 2', status: 'PLANNED', sp_total: 0 });
    
    const edge = { from_id: 'F018', to_id: 'F019', edge_type: 'DEPENDS_ON' };
    insertEdge(edge);
    
    const edges = getEdgesForFeature('F019');
    expect(edges).toContainEqual(expect.objectContaining(edge));
  });

  it('FR-001: should support recursive dependency traversal (CTE)', () => {
    insertFeature({ id: 'A', name: 'A', status: 'PLANNED', sp_total: 0 });
    insertFeature({ id: 'B', name: 'B', status: 'PLANNED', sp_total: 0 });
    insertFeature({ id: 'C', name: 'C', status: 'PLANNED', sp_total: 0 });
    
    insertEdge({ from_id: 'A', to_id: 'B', edge_type: 'DEPENDS_ON' });
    insertEdge({ from_id: 'B', to_id: 'C', edge_type: 'DEPENDS_ON' });
    
    // @ts-ignore - hypothetical recursive query
    const allDeps = getAllDependencies('C');
    expect(allDeps.map(d => d.id)).toContain('A');
    expect(allDeps.map(d => d.id)).toContain('B');
  });
});