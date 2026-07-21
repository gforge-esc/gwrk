/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { resolveDepEdge } from "./plan.js";

describe("resolveDepEdge (dep-direction footgun)", () => {
  it("--needs: '<feature> --needs <prereq>' stores canonical prerequisite → dependent", () => {
    const { edge } = resolveDepEdge("002", undefined, "001", "DEPENDS_ON");
    // internal convention: from = prerequisite (runs first), to = dependent
    expect(edge).toEqual({
      from_id: "001",
      to_id: "002",
      edge_type: "DEPENDS_ON",
    });
  });

  it("--needs: message states the dependency in plain English", () => {
    const { message } = resolveDepEdge("002", undefined, "001", "DEPENDS_ON");
    expect(message).toContain("002 depends on 001");
    expect(message).toContain("001"); // prerequisite ships first
  });

  it("positional 'add <from> <to>' keeps prerequisite → dependent and echoes order", () => {
    const { edge, message } = resolveDepEdge("001", "002", undefined, "DEPENDS_ON");
    expect(edge).toEqual({ from_id: "001", to_id: "002", edge_type: "DEPENDS_ON" });
    expect(message).toContain("001"); // prerequisite
    expect(message).toContain("002"); // dependent
    expect(message.toLowerCase()).toContain("needs"); // hints at the explicit flag
  });

  it("rejects combining a positional <to> with --needs", () => {
    expect(() => resolveDepEdge("002", "003", "001", "DEPENDS_ON")).toThrow();
  });

  it("rejects when neither a positional <to> nor --needs is given", () => {
    expect(() => resolveDepEdge("002", undefined, undefined, "DEPENDS_ON")).toThrow();
  });
});
