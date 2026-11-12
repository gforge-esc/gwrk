/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import os from "node:os";
import { describe, expect, it } from "vitest";
import { computeProjectId, computeProjectKey } from "./project-id.js";

describe("Project identity from supplied facts", () => {
  it("normalizes remotes without keeping user information", () => {
    for (const remoteOriginUrl of [
      "git@GitHub.com:Acme/Widget.git",
      "  https://ci@GitHub.com/Acme/Widget.git  ",
    ]) {
      expect(computeProjectKey({ projectRoot: "/repo", remoteOriginUrl })).toBe(
        "remote:github.com/acme/widget",
      );
    }
  });

  it("uses the main worktree and then the supplied project path", () => {
    expect(
      computeProjectKey({
        projectRoot: "/linked",
        remoteOriginUrl: "",
        gitCommonDir: "/main/.git",
      }),
    ).toBe("local:/main");
    expect(computeProjectKey({ projectRoot: "/linked" })).toBe("path:/linked");
  });

  it("preserves the existing digest regardless of the process directory", () => {
    const cwd = process.cwd();
    const facts = {
      projectRoot: "/repo",
      remoteOriginUrl: "git@github.com:acme/widget.git",
    };
    const id = computeProjectId(facts);
    expect(id).toBe("d3ff282248a70b8d0b7e4789e0ee5a48");
    try {
      process.chdir(os.tmpdir());
      expect(computeProjectId(facts)).toBe(id);
    } finally {
      process.chdir(cwd);
    }
  });
});
