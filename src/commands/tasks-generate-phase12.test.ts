/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import fs from "node:fs";

describe('tasks-generate (Phase 12)', () => {
  describe('FR-028: Quiet mode parity', () => {
    it('MUST NOT contain LLM gate authoring codepath (removed in Block 0C)', () => {
      // Block 0C (d9cfc23) removed the gwrk-author-gates workflow invocation
      // from tasks-generate.ts. Deterministic gate generation replaced it.
      // This test verifies the LLM gate authoring path stays deleted.
      const source = fs.readFileSync(
        new URL("./tasks-generate.ts", import.meta.url).pathname,
        "utf-8",
      );

      // The old codepath called runtime.executeWorkflow("gwrk-author-gates", ...)
      // It must NOT exist in the source anymore
      expect(source).not.toContain("gwrk-author-gates");

      // The deterministic path should exist instead
      expect(source).toContain("generateDeterministicGates");
    });
  });
});
