import { beforeEach, describe, expect, it, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { PlanStore } from './plan-store.js';
import { getDb, closeDb } from '../db/index.js';

describe('PlanStore Integration (FR-001/005/009/013)', () => {
  let store: PlanStore;
  const dbPath = path.join(process.cwd(), 'test-plan.sqlite');

  beforeEach(() => {
    // Ensure we are using a clean test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    process.env.GWRK_DB_PATH = dbPath;
    store = new PlanStore();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('should seed from markdown and render back', () => {
    const markdown = `
# 000 Build Plan — gwrk

> **Status:** Authoritative · **Date:** 2026-04-14
> **Anchored to:** [architecture.md](docs/architecture.md), [GWRK-PRD-PRFAQ.md](docs/GWRK-PRD-PRFAQ.md)

---

## Dependency Graph

\`\`\`mermaid
graph TD
    F000["F000: Extraction ✅"] --> F001["F001: CLI Core ✅"]
\`\`\`

---

## Features

### Feature 000 — Extraction ✅

**Status:** DONE

| Phase | Name | Status | SP |
|---|---|---|---|
| 1 | Extract | DONE ✅ | 3 |

### Feature 001 — CLI Core ✅

**Status:** DONE

| Phase | Name | Status | SP |
|---|---|---|---|
| 1 | Bootstrap | DONE ✅ | 5 |
`;
    const tempPlanPath = path.join(process.cwd(), 'temp-plan.md');
    fs.writeFileSync(tempPlanPath, markdown, 'utf-8');

    try {
      store.seedFromFile(tempPlanPath);
      
      const status = store.getPlanStatus();
      expect(status.features).toHaveLength(2);
      expect(status.edges).toHaveLength(1);
      
      const rendered = store.render();
      expect(rendered).toContain('F000["F000: Extraction ✅"] --> F001["F001: CLI Core ✅"]');
      expect(rendered).toContain('### Feature 000 — Extraction ✅');
      expect(rendered).toContain('### Feature 001 — CLI Core ✅');
    } finally {
      if (fs.existsSync(tempPlanPath)) {
        fs.unlinkSync(tempPlanPath);
      }
    }
  });
});
