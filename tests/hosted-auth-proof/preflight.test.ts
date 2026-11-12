/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Hosted sign-in deployment preflight", () => {
  let dir: string;
  const write = (name: string, value: string) =>
    writeFileSync(path.join(dir, name), value);
  const check = () =>
    spawnSync("bash", ["preflight.sh"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "gwrk-proof-preflight-"));
    mkdirSync(path.join(dir, "local"));
    copyFileSync(
      "deploy/hosted-auth-proof/preflight.sh",
      path.join(dir, "preflight.sh"),
    );
    write(
      ".env",
      "GWRK_PROOF_ACME_EMAIL=operator@gwrk.test\nGWRK_PROOF_GOOGLE_CLIENT_ID=synthetic.apps.googleusercontent.com\n",
    );
    write("local/google-client-secret", randomBytes(24).toString("base64url"));
    write("local/cookie-secret", randomBytes(32).toString("base64url"));
    write("local/allowed-emails", "operator@gwrk.test\n");
    writeFileSync(
      path.join(dir, "docker"),
      "#!/bin/sh\ntest \"$*\" = 'compose --env-file .env -f compose.yaml config --quiet'\n",
      { mode: 0o755 },
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("checks Compose configuration after validating operator inputs", () => {
    expect(check().status).toBe(0);
  });

  it.each([
    [".env", "", "create .env"],
    [
      ".env",
      "GWRK_PROOF_ACME_EMAIL=operator@example.invalid\nGWRK_PROOF_GOOGLE_CLIENT_ID=replace.apps.googleusercontent.com\n",
      "replace example",
    ],
    [
      "local/google-client-secret",
      "placeholder1234567890",
      "replace the example",
    ],
    ["local/google-client-secret", "", "provide local/google-client-secret"],
    ["local/cookie-secret", "short", "generate a 32-byte"],
    ["local/allowed-emails", "*@gwrk.test\n", "one explicit email"],
    [
      "local/allowed-emails",
      "operator@example.com\n",
      "replace example allowlist",
    ],
  ])("rejects invalid input in %s", (name, value, message) => {
    write(name, value);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });
});
