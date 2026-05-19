import { describe, it, expect } from 'vitest';
import fs from "node:fs";

describe('tasks-generate (Phase 12)', () => {
  describe('FR-028: Quiet mode parity', () => {
    it('MUST pass quiet: true to executeWorkflow for gate generation', () => {
      // Source-level verification: tasks-generate.ts must include quiet: true
      // in its executeWorkflow call for gate authoring.
      // This is a compile-time contract — the gate authoring codepath is deeply
      // nested and requires extensive fixture setup to exercise via command dispatch.
      const source = fs.readFileSync(
        new URL("./tasks-generate.ts", import.meta.url).pathname,
        "utf-8",
      );

      // Find the executeWorkflow call block and verify quiet: true is present
      const workflowCallMatch = source.match(
        /runtime\.executeWorkflow\(\s*"gwrk-author-gates"[\s\S]*?\{([^}]*quiet[^}]*)\}/,
      );
      expect(workflowCallMatch).not.toBeNull();
      expect(workflowCallMatch![1]).toContain("quiet: true");
    });
  });
});
