/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = "deploy/linux-runner";
const read = (name: string) => readFileSync(`${root}/${name}`, "utf8");

describe("Linux runner service bundle", () => {
  it("runs as a restricted user and preserves its runtime lock across stop", () => {
    const unit = read("gwrk-runner.service");
    for (const directive of [
      "User=gwrk",
      "Group=gwrk",
      "RuntimeDirectoryPreserve=yes",
      "KillMode=control-group",
      "ProtectHome=true",
      "ProtectSystem=strict",
      "NoNewPrivileges=true",
      "ReadWritePaths=/var/lib/gwrk /run/gwrk",
      "ReadOnlyPaths=/opt/gwrk /etc/gwrk/secrets",
    ]) {
      expect(unit.split("\n")).toContain(directive);
    }
    expect(unit).toMatch(/^ExecStartPre=.*\/preflight\.sh$/m);
    expect(unit).toMatch(/^ExecStart=.*\/run\.sh$/m);
    expect(read("run.sh")).toContain("server start --foreground");
  });

  it("packages the operator templates without secret environment values", () => {
    const example = read(".env.example");
    expect(example).toContain("GWRK_LISTEN_HOST=127.0.0.1");
    expect(example).toContain("GWRK_SLACK_ENABLED=0");
    expect(example).not.toMatch(
      /^(GH_TOKEN|SLACK_.*_TOKEN|TELEGRAM_.*|.*API_KEY)=/m,
    );
    for (const file of ["preflight.sh", "credentials.sh", "run.sh"]) {
      expect(() =>
        execFileSync("bash", ["-n", `${root}/${file}`]),
      ).not.toThrow();
    }
  });

  it("runs the built CLI through the active release symlink", () => {
    const fixture = mkdtempSync(join(tmpdir(), "gwrk-release-link-"));
    try {
      const active = join(fixture, "current");
      symlinkSync(process.cwd(), active, "dir");
      const { version } = JSON.parse(readFileSync("package.json", "utf8"));
      const output = execFileSync(
        process.execPath,
        [join(active, "dist/cli.js"), "--version"],
        { encoding: "utf8" },
      );
      expect(output.trim()).toBe(version);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("keeps live systemd, credentials and worker evidence pending", () => {
    const record = read("live-pilot-record.example.md");
    for (const check of [
      "systemd start and restart",
      "Git and agent credential revocation",
      "Unattended worker run ID",
      "Accepted work recovery after restart",
    ]) {
      expect(record).toContain(`| ${check} | Pending |`);
    }
  });
});
