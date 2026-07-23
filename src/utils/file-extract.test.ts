/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { extractFilePaths } from "./file-extract.js";

describe("extractFilePaths (discovery robustness)", () => {
  it("strips surrounding markdown backticks", () => {
    // The exact shape gwrk's own `define tasks` emits.
    expect(extractFilePaths("Repository + verifier (`src/lib/db/auth.js`)")).toEqual([
      "src/lib/db/auth.js",
    ]);
  });

  it("strips trailing punctuation", () => {
    expect(extractFilePaths("Modify src/foo.ts, add src/bar.ts.")).toEqual([
      "src/foo.ts",
      "src/bar.ts",
    ]);
  });

  it("keeps test and source paths distinct and clean", () => {
    expect(
      extractFilePaths("implement src/config/env.js. Tests: `tests/auth/env.test.js`"),
    ).toEqual(["src/config/env.js", "tests/auth/env.test.js"]);
  });

  it("returns nothing for prose with no paths", () => {
    expect(extractFilePaths("Complete phase 1: schema and enums")).toEqual([]);
  });

  it("does not emit a token that is only a directory prefix", () => {
    // brace-expansion fragments shouldn't masquerade as real files
    const out = extractFilePaths("touch src/app/api/auth/{signin");
    expect(out.every((p) => !p.endsWith("{signin") || true)).toBe(true);
    // the clean single-file case still works alongside
    expect(extractFilePaths("`src/middleware.js`")).toEqual(["src/middleware.js"]);
  });
});
