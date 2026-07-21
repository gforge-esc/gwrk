/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from "vitest";
import { extractPhases } from "./phase-extractor.js";

describe("extractPhases", () => {
  it("parses '### Phase N — Title (K SP)' headings with SP", () => {
    const md = "### Phase 1 — Config and schema (7 SP)\n\nbody text";
    expect(extractPhases(md)).toEqual([
      { seq: 1, title: "Config and schema", sp: 7 },
    ]);
  });

  it("parses '### Phase N: Title' headings without SP as sp 0", () => {
    const md = "### Phase 2: Redacted read composer";
    expect(extractPhases(md)).toEqual([
      { seq: 2, title: "Redacted read composer", sp: 0 },
    ]);
  });

  it("keeps non-SP parentheticals in the title", () => {
    const md = "### Phase 1 — Config, air-gap (foundation)";
    expect(extractPhases(md)).toEqual([
      { seq: 1, title: "Config, air-gap (foundation)", sp: 0 },
    ]);
  });

  it("parses numbered list items that start with a phase declaration", () => {
    const md = [
      "## Implementation Phases",
      "1. **Phase 1 — Windows helper (3 SP):** pure functions",
      "2. **Phase 2 — Read-only client (5 SP):** READ ONLY txns",
    ].join("\n");
    expect(extractPhases(md)).toEqual([
      { seq: 1, title: "Windows helper", sp: 3 },
      { seq: 2, title: "Read-only client", sp: 5 },
    ]);
  });

  it("parses bulleted list items starting with a phase declaration", () => {
    const md = "- Phase 3: Runner and provenance (5 SP)";
    expect(extractPhases(md)).toEqual([
      { seq: 3, title: "Runner and provenance", sp: 5 },
    ]);
  });

  it("ignores list items that merely MENTION a phase (not a declaration)", () => {
    const md =
      "- **OQ-2/OQ-3 (RAG bands):** bands come from the metric. **Accepted** (Phase 2).";
    expect(extractPhases(md)).toEqual([]);
  });

  it("ignores markdown table rows that mention a phase inline", () => {
    const md =
      "| `env.js` | 001's reader | **amend** (Phase 1): add readers |";
    expect(extractPhases(md)).toEqual([]);
  });

  it("dedupes by seq (heading wins over a later list mention)", () => {
    const md = ["### Phase 1 — Real title (4 SP)", "1. Phase 1 — stub"].join(
      "\n",
    );
    expect(extractPhases(md)).toEqual([
      { seq: 1, title: "Real title", sp: 4 },
    ]);
  });

  it("returns phases sorted by seq regardless of document order", () => {
    const md = ["### Phase 2 — Second", "### Phase 1 — First"].join("\n");
    expect(extractPhases(md)).toEqual([
      { seq: 1, title: "First", sp: 0 },
      { seq: 2, title: "Second", sp: 0 },
    ]);
  });

  it("returns empty for a plan with no structured phase headings/lists", () => {
    const md = "## 1. Overview\n\nSome prose about the feature and its scope.";
    expect(extractPhases(md)).toEqual([]);
  });
});
