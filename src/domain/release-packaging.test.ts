/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  evaluateRollbackCompatibility,
  validateReleaseManifest,
  validateRunnerLayout,
} from "./release-packaging.js";

const firstMigration = "001-init.sql";
const secondMigration = "002-ledger.sql";
const manifest = {
  version: "1.6.0-beta.1",
  commitSha: "a".repeat(40),
  builtAt: "2026-11-11T00:00:00Z",
  nodeVersion: "22.14.0",
  nodeAbi: "127",
  platform: "linux",
  arch: "x64",
  tarballSha256: "b".repeat(64),
  lockfileSha256: "c".repeat(64),
  plugins: [{ kind: "agent", name: "agy", version: "1.1.0" }],
  migrations: [{ name: firstMigration, sha256: "d".repeat(64) }],
} as const;

const layout = {
  releaseRoot: "/opt/gwrk",
  stateRoot: "/var/lib/gwrk",
  runtimeRoot: "/run/gwrk",
  secretsRoot: "/etc/gwrk/secrets",
  listenHost: "127.0.0.1",
  listenPort: 18790,
  telegramEnabled: false,
  credentialPaths: ["/etc/gwrk/secrets/agent"],
};

describe("Linux release manifest", () => {
  it("accepts a pinned release with runtime and artifact provenance", () => {
    expect(validateReleaseManifest(manifest)).toEqual({
      ok: true,
      value: manifest,
    });
  });

  it.each([
    { tarballSha256: "invalid" },
    { nodeAbi: undefined },
    { nodeVersion: "20.19.0" },
    { commitSha: "develop" },
    { platform: "darwin" },
    { migrations: [{ name: "../schema.sql", sha256: "d".repeat(64) }] },
    { migrations: [...manifest.migrations, ...manifest.migrations] },
    { plugins: [...manifest.plugins, ...manifest.plugins] },
  ])("rejects malformed release metadata %j", (overrides) => {
    expect(validateReleaseManifest({ ...manifest, ...overrides }).ok).toBe(
      false,
    );
  });
});

describe("Linux runner layout", () => {
  it.each(["127.0.0.1", "::1", "172.20.1.9"])(
    "accepts a separate layout bound to %s",
    (listenHost) => {
      const selected = { ...layout, listenHost };
      expect(validateRunnerLayout(selected, ["/Users/operator"])).toEqual({
        ok: true,
        value: selected,
      });
    },
  );

  it.each([
    { listenHost: "0.0.0.0" },
    { listenHost: "::" },
    { listenHost: "192.168.500.1" },
    { listenHost: "172.32.1.9" },
    { listenHost: "8.8.8.8" },
    { listenPort: 0 },
    { stateRoot: "/opt/gwrk/state" },
    { runtimeRoot: "/run/gwrk/../other" },
    { secretsRoot: "/Users/operator/.config/gwrk" },
    { credentialPaths: ["/etc/gwrk/secrets-elsewhere/key"] },
    { credentialPaths: ["/etc/gwrk/secrets"] },
    { telegramEnabled: true },
  ])("rejects an unsafe layout %j", (overrides) => {
    expect(
      validateRunnerLayout({ ...layout, ...overrides }, ["/Users/operator"]).ok,
    ).toBe(false);
  });
});

describe("Linux release rollback", () => {
  it("allows the target when every applied migration has the same digest", () => {
    expect(
      evaluateRollbackCompatibility([firstMigration], manifest, manifest),
    ).toEqual({
      allowed: true,
      targetVersion: manifest.version,
    });
  });

  it("blocks changed and missing migrations before switching release", () => {
    const current = {
      ...manifest,
      migrations: [
        ...manifest.migrations,
        { name: secondMigration, sha256: "e".repeat(64) },
      ],
    };
    const target = {
      ...manifest,
      migrations: [{ name: firstMigration, sha256: "f".repeat(64) }],
    };
    expect(
      evaluateRollbackCompatibility(
        [firstMigration, secondMigration],
        current,
        target,
      ),
    ).toEqual({
      allowed: false,
      targetVersion: target.version,
      blockingMigrations: [firstMigration, secondMigration],
    });
  });

  it("blocks a target that would add a migration during rollback", () => {
    const target = {
      ...manifest,
      migrations: [
        ...manifest.migrations,
        { name: secondMigration, sha256: "e".repeat(64) },
      ],
    };
    expect(
      evaluateRollbackCompatibility([firstMigration], manifest, target),
    ).toMatchObject({
      allowed: false,
      blockingMigrations: [secondMigration],
    });
  });

  it("blocks an applied migration with missing provenance", () => {
    expect(
      evaluateRollbackCompatibility(
        [firstMigration],
        { ...manifest, migrations: [] },
        manifest,
      ),
    ).toMatchObject({ allowed: false, blockingMigrations: [firstMigration] });
  });
});
