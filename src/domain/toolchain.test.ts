/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import os from "node:os";
import { describe, expect, it } from "vitest";
import { resolveBuildCommand } from "./toolchain.js";
import type { ProjectProfile } from "./types.js";

const profile = { type: "fixture" } as ProjectProfile;
const node = { hasPackageJson: true, hasPackageBuildScript: true };

describe("Build command from supplied manifest facts", () => {
  it("prefers explicit commands, including an explicit opt-out", () => {
    expect(
      resolveBuildCommand({ ...profile, toolchain: { build: null } }, node),
    ).toBeNull();
    expect(
      resolveBuildCommand({ ...profile, toolchain: { build: "make" } }, node),
    ).toBe("make");
  });

  it("applies package-manager precedence and preserves the Node manifest boundary", () => {
    expect(
      resolveBuildCommand(profile, {
        ...node,
        hasPnpmLock: true,
        hasYarnLock: true,
      }),
    ).toBe("pnpm build");
    expect(resolveBuildCommand(profile, { ...node, hasYarnLock: true })).toBe(
      "yarn build",
    );
    expect(resolveBuildCommand(profile, node)).toBe("npm run build");
    expect(
      resolveBuildCommand(profile, {
        hasPackageJson: true,
        hasCargoToml: true,
      }),
    ).toBeNull();
  });

  it("infers Rust and Go independently of the current directory", () => {
    const cwd = process.cwd();
    try {
      for (const location of [cwd, os.tmpdir()]) {
        process.chdir(location);
        expect(
          resolveBuildCommand(profile, { hasCargoToml: true, hasGoMod: true }),
        ).toBe("cargo build");
        expect(resolveBuildCommand(profile, { hasGoMod: true })).toBe(
          "go build ./...",
        );
        expect(resolveBuildCommand(profile)).toBeNull();
      }
    } finally {
      process.chdir(cwd);
    }
  });
});
