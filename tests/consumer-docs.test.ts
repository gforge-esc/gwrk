/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const json = (file: string) => JSON.parse(read(file));

const INSTALL_DOCS = ["README.md", "docs/site/getting-started.md"];
const ACTIVE_DOCS = [
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CONTRIBUTING.md",
  "docs/DEVELOPMENT.md",
  ...readdirSync(path.resolve("docs/site"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/site/${name}`),
];

describe("consumer install documentation", () => {
  it.each(INSTALL_DOCS)(
    "%s verifies the checksum before extraction and installs an executable on PATH",
    (file) => {
      const doc = read(file);
      const checksum = doc.indexOf('shasum -a 256 -c "gwrk-$TAG.tgz.sha256"');
      const extract = doc.indexOf('tar -xzf "gwrk-$TAG.tgz"');
      expect(checksum).toBeGreaterThan(-1);
      expect(extract).toBeGreaterThan(checksum);
      expect(doc).toMatch(/mkdir -p [^\n]*"\$HOME\/\.gwrk\/bin"/);
      expect(doc).toContain("chmod 755 dist/cli.js");
      expect(doc).toContain(
        'ln -sfn "$HOME/.gwrk/releases/$VERSION/dist/cli.js" "$HOME/.gwrk/bin/gwrk"',
      );
      expect(doc).toContain('export PATH="$HOME/.gwrk/bin:$PATH"');
      expect(doc).toContain(
        'BASE="https://github.com/gforge-esc/gwrk/releases/download/$TAG"',
      );
    },
  );

  it("documents release asset names that release.yml uploads", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('file="gwrk-${tag}.tgz"');
    expect(workflow).toContain(
      'gh release upload "$tag" "$file" "${file}.sha256" release-manifest.json install-release.sh',
    );
    const guide = read("docs/site/getting-started.md");
    for (const asset of [
      '"$BASE/gwrk-$TAG.tgz"',
      '"$BASE/gwrk-$TAG.tgz.sha256"',
      '"$BASE/release-manifest.json"',
      '"$BASE/install-release.sh"',
    ]) {
      expect(guide).toContain(asset);
    }
  });

  it("documents the Linux installer arguments that install-release.sh accepts", () => {
    const installer = read("deploy/linux-runner/install-release.sh");
    expect(installer).toContain(
      "Usage: install-release.sh TARBALL MANIFEST [RELEASE_ROOT]",
    );
    expect(installer).toContain('checksum=$(realpath -e -- "$1.sha256")');
    const guide = read("docs/site/getting-started.md");
    expect(guide).toContain("`TARBALL MANIFEST [RELEASE_ROOT]`");
    expect(guide).toContain(
      'bash install-release.sh "gwrk-$TAG.tgz" release-manifest.json /opt/gwrk',
    );
  });

  it.each(INSTALL_DOCS)(
    "%s carries no pre-publication approval wait",
    (file) => {
      expect(read(file)).not.toMatch(
        /Blocked: public|once published|awaits? (?:reviewed|David)|Wait for `cli-v/,
      );
    },
  );
});

describe("active documentation credential safety", () => {
  it.each(ACTIVE_DOCS)("%s keeps keys out of command arguments", (file) => {
    const doc = read(file);
    expect(doc).not.toMatch(/Bearer \$\(cat/);
    expect(doc).not.toContain("gwrk_ak_v1_");
    expect(doc).not.toContain("/var/lib/gwrk/operator-keys/");
    expect(doc).not.toContain("Cookie: __Host-gwrk_session");
  });

  it.each(ACTIVE_DOCS)("%s uses the actual gate grammar", (file) => {
    expect(read(file)).not.toMatch(/gwrk gate \S+ <taskId>/);
  });
});

describe("release version ownership", () => {
  it("pins release-please to the package version without a manual changelog section", () => {
    const pkg = json("package.json");
    const config = json(".release-please-config.json").packages["."];
    const manifest = json(".release-please-manifest.json")["."];
    expect(config.prerelease).toBe(true);
    if (config["release-as"] !== undefined) {
      expect(config["release-as"]).toBe(pkg.version);
    }
    if (manifest !== pkg.version) {
      expect(read("CHANGELOG.md")).not.toContain(`## [${pkg.version}]`);
    }
  });
});
