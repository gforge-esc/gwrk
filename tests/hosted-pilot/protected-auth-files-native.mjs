/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Replay after pnpm build, under the existing heavy-check wrapper. Requires a cached image.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = "/etc/gwrk/secrets";
const ACCOUNT = `${ROOT}/accounts`;
const HMAC = `${ROOT}/hmac`;
const GID = 1479;
const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const inside = process.argv.includes("--inside");
if (inside) {
  const { createProtectedHostedAuthFiles, resolveTrustedGwrkGroupId } =
    await import("../../dist/adapters/auth/protected-hosted-auth-files.js");
  const gid = await resolveTrustedGwrkGroupId();
  assert.equal(gid, GID);
  const scenario = process.argv.at(-1);
  const reader = createProtectedHostedAuthFiles({
    secretsRoot: ROOT,
    googleAllowlistFile: ACCOUNT,
    csrfHmacKeyFile: HMAC,
    trustedGroupId: gid,
  });
  if (scenario === "valid") {
    assert.deepEqual(await reader.readAllowlist(), ["operator@example.test"]);
    assert.deepEqual(await reader.readCsrfHmacKey(), key);
  } else if (scenario === "deny-account" || scenario === "deny-hmac") {
    const read =
      scenario === "deny-account"
        ? () => reader.readAllowlist()
        : () => reader.readCsrfHmacKey();
    await assert.rejects(read, (error) => {
      assert.equal(error.code, "AUTH_FILE_UNAVAILABLE");
      assert.equal(error.message, "Protected authentication file unavailable");
      assert.equal(error.cause, undefined);
      const text = String(error) + JSON.stringify(error);
      assert.equal(text.includes(ROOT), false);
      assert.equal(text.includes(key.toString("base64url")), false);
      return true;
    });
  } else if (scenario === "live-allowlist") {
    const { createGoogleIdentityVerifier } = await import(
      "../../dist/adapters/auth/google-id-token.js"
    );
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "protected-reader-fixture",
      alg: "RS256",
      use: "sig",
    };
    const now = Date.now();
    const token = await new SignJWT({
      email: "operator@example.test",
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
      .setIssuer("https://accounts.google.com")
      .setAudience("protected-reader-fixture")
      .setSubject("local-fixture")
      .setIssuedAt(Math.floor(now / 1000) - 1)
      .setExpirationTime(Math.floor(now / 1000) + 300)
      .sign(privateKey);
    const verifier = createGoogleIdentityVerifier({
      clientId: "protected-reader-fixture",
      readAllowlist: reader.readAllowlist,
      fetch: async () => Response.json({ keys: [jwk] }),
    });
    assert.equal(
      (await verifier.verifyIdToken({ token, nowMs: now })).ok,
      true,
    );
    fs.writeFileSync("/tmp/gwrk-reader-ready", "ready");
    const deadline = Date.now() + 8000;
    while (!fs.existsSync("/tmp/gwrk-reader-continue")) {
      assert.ok(
        Date.now() < deadline,
        "Controller failed to replace allowlist",
      );
      await delay(10);
    }
    const denied = await verifier.verifyIdToken({ token, nowMs: now + 1 });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "AUTH_ACCOUNT_DENIED");
  } else {
    throw new Error("Unknown native fixture scenario");
  }
  console.log(
    JSON.stringify({
      scenario,
      result: "PASS",
      node: process.version,
      uid: process.getuid(),
      gid: process.getgid(),
      groups: process.getgroups(),
    }),
  );
} else {
  const image = process.argv[2] ?? "node:22-bookworm";
  const container = `gwrk-protected-reader-${randomUUID()}`;
  const metadata = JSON.parse(
    execFileSync("docker", ["image", "inspect", image], {
      encoding: "utf8",
      timeout: 10000,
    }),
  )[0];
  const run = (args, options = {}) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
  const shell = (source) =>
    run(["exec", "-i", container, "bash", "-seu"], { input: source });
  const observed = [];
  const check = (scenario, user = "0:0") => {
    const output = run([
      "exec",
      "--user",
      user,
      container,
      "node",
      "/workspace/tests/hosted-pilot/protected-auth-files-native.mjs",
      "--inside",
      scenario,
    ]);
    observed.push(JSON.parse(output.trim()));
  };
  const reset = () =>
    shell(`
rm -rf /etc/gwrk
install -d -m 0755 /etc/gwrk
install -d -m 0750 -o 0 -g 1479 /etc/gwrk/secrets
printf 'operator@example.test\n' > /etc/gwrk/secrets/accounts
node --input-type=module -e 'import fs from "node:fs";fs.writeFileSync("/etc/gwrk/secrets/hmac",Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString("base64url")+"\\n");'
chown 0:1479 /etc/gwrk/secrets/accounts /etc/gwrk/secrets/hmac
chmod 0640 /etc/gwrk/secrets/accounts /etc/gwrk/secrets/hmac
`);
  let started = false;
  let live;
  try {
    run([
      "run",
      "--detach",
      "--pull",
      "never",
      "--name",
      container,
      "--network",
      "none",
      "--mount",
      `type=bind,src=${workspace},dst=/workspace,readonly`,
      image,
      "sleep",
      "infinity",
    ]);
    started = true;
    assert.equal(
      run(["inspect", "--format", "{{.Image}}", container]).trim(),
      metadata.Id,
    );
    shell(
      "groupadd --gid 1479 gwrk\nuseradd --uid 1479 --gid 1479 --no-create-home --shell /usr/sbin/nologin gwrk\ngroupadd --gid 1480 foreign\nuseradd --uid 1480 --gid 1480 --no-create-home --shell /usr/sbin/nologin foreign\n",
    );
    reset();
    check("valid");
    check("valid", "1479:1479");
    check("deny-account", "1480:1480");
    shell("chown 0:1480 /etc/gwrk/secrets/accounts");
    check("deny-account");
    check("deny-account", "1479:1479");
    shell("chown 1479:1479 /etc/gwrk/secrets/accounts");
    check("deny-account");
    check("deny-account", "1479:1479");
    shell(
      "chown 0:1479 /etc/gwrk/secrets/accounts\nchmod 0644 /etc/gwrk/secrets/accounts",
    );
    check("deny-account");
    check("deny-account", "1479:1479");
    shell("chmod 0640 /etc/gwrk/secrets/accounts");
    check("valid", "1479:1479");
    shell("chmod 0770 /etc/gwrk/secrets");
    check("deny-account");
    check("deny-account", "1479:1479");
    reset();
    shell(
      "mv /etc/gwrk/secrets/accounts /etc/gwrk/secrets/original\nln -s original /etc/gwrk/secrets/accounts",
    );
    check("deny-account");
    check("deny-account", "1479:1479");
    reset();
    shell(
      "mv /etc/gwrk/secrets /etc/gwrk/actual-secrets\nln -s actual-secrets /etc/gwrk/secrets",
    );
    check("deny-account");
    check("deny-account", "1479:1479");
    reset();
    shell(
      "rm /etc/gwrk/secrets/hmac\nmkfifo -m 0640 /etc/gwrk/secrets/hmac\nchown 0:1479 /etc/gwrk/secrets/hmac",
    );
    check("deny-hmac");
    check("deny-hmac", "1479:1479");
    reset();
    shell("printf 'noncanonical=\n' > /etc/gwrk/secrets/hmac");
    check("deny-hmac", "1479:1479");
    reset();
    live = spawn(
      "docker",
      [
        "exec",
        "--user",
        "1479:1479",
        container,
        "node",
        "/workspace/tests/hosted-pilot/protected-auth-files-native.mjs",
        "--inside",
        "live-allowlist",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    live.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    live.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const completed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        live.kill("SIGKILL");
        reject(new Error("Native verifier fixture timed out"));
      }, 12000);
      live.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      live.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Native verifier fixture failed: ${stderr}`));
      });
    });
    // Attach immediately so a controller failure cannot create an unhandled rejection.
    void completed.catch(() => {});
    const deadline = Date.now() + 8000;
    for (;;) {
      try {
        run(["exec", container, "test", "-f", "/tmp/gwrk-reader-ready"]);
        break;
      } catch {
        assert.ok(
          Date.now() < deadline,
          "Verifier did not reach initial allowed decision",
        );
        await delay(30);
      }
    }
    shell(
      "printf 'other@example.test\n' > /etc/gwrk/secrets/accounts\ntouch /tmp/gwrk-reader-continue",
    );
    await completed;
    observed.push(JSON.parse(stdout.trim()));
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          image,
          imageId: metadata.Id,
          repoDigests: metadata.RepoDigests,
          platform: `${metadata.Os}/${metadata.Architecture}`,
          network: "none",
          mount: "own worktree read-only",
          cases: observed.length,
          observed,
        },
        null,
        2,
      ),
    );
  } finally {
    if (live && live.exitCode === null) live.kill("SIGKILL");
    if (started) run(["rm", "--force", container]);
  }
}
