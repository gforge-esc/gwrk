/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const bash =
  ["/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/bin/bash"].find(
    existsSync,
  ) ?? "/bin/bash";

// Frozen deployment mapping: specs/051-hosted-aws-pilot/contracts/deployment-boundary.md.
// UID/GID metadata is controlled; permission bits and script execution use real fixtures.
describe("FR-016: hosted runner authentication preflight", () => {
  let root: string;
  let bin: string;
  let scripts: string;
  let secrets: string;
  let trace: string;
  let metadata: string;
  let env: NodeJS.ProcessEnv;
  let csrf: string;

  const stub = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!${bash}\nset -eu\n${body}\n`, {
      mode: 0o755,
    });
  const calls = () =>
    existsSync(trace)
      ? readFileSync(trace, "utf8").trim().split("\n").filter(Boolean)
      : [];
  const execute = (command: string, extra: NodeJS.ProcessEnv = {}) => {
    const result = spawnSync(bash, ["--noprofile", "--norc", "-c", command], {
      cwd: env.GWRK_PILOT_REPO,
      env: { ...env, ...extra },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    return result;
  };
  const preflight = (extra: NodeJS.ProcessEnv = {}) =>
    execute('bash "$FIXTURE_SCRIPTS/preflight.sh"', extra);
  const readAgentCredential = () =>
    execute(
      'source "$FIXTURE_SCRIPTS/credentials.sh"; read_credential agent-credential >/dev/null',
    );

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-preflight-auth-")));
    bin = join(root, "bin");
    secrets = join(root, "secrets");
    trace = join(root, "calls");
    metadata = join(root, "owners.json");
    const state = join(root, "state");
    const runtime = join(root, "runtime");
    const releaseRoot = join(root, "release-root");
    const release = join(releaseRoot, "releases/candidate");
    const repo = join(state, "repos/pilot");
    const plugin = join(state, "plugins/agents/fixture");
    scripts = join(release, "deploy/linux-runner");
    for (const dir of [bin, secrets, runtime, scripts, repo, plugin]) {
      mkdirSync(dir, { recursive: true });
    }
    symlinkSync(bash, join(bin, "bash"));
    symlinkSync(release, join(releaseRoot, "current"));
    symlinkSync(join(process.cwd(), "dist"), join(release, "dist"));
    for (const name of ["preflight.sh", "credentials.sh", "run.sh"]) {
      copyFileSync(join("deploy/linux-runner", name), join(scripts, name));
    }
    writeFileSync(join(metadata), "{}");
    writeFileSync(
      join(secrets, "pilot-git-credential"),
      "synthetic-git-canary",
      { mode: 0o640 },
    );
    writeFileSync(join(secrets, "agent-credential"), "synthetic-agent-canary", {
      mode: 0o640,
    });
    writeFileSync(
      join(plugin, "manifest.yaml"),
      `type: agent
name: fixture
version: 1.0.0
description: Synthetic preflight backend
adapter: adapter.js
dispatchMode: local-cli
contextFileName: AGENTS.md
capabilities: [stdin]
models: {}
exitCodeMap: {}
`,
    );
    writeFileSync(
      join(plugin, "adapter.js"),
      `export default {
name: "fixture", async isAvailable() { return true; },
dispatch() { throw new Error("No inference permitted in preflight fixture"); },
parseResult(stdout, stderr, exitCode) { return { stdout, stderr, exitCode }; }
};`,
    );
    writeFileSync(
      join(repo, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "pilot" },
        server: { host: "127.0.0.1", port: 18790 },
        parallelism: { local: { maxClones: 1 } },
        agents: {
          define: "fixture",
          implement: "fixture",
          fallbackOrder: ["fixture"],
          registry: {
            fixture: {
              type: "local-cli",
              command: "agent-probe",
              quotaProbe: { method: "optimistic", cacheTTLMinutes: 0 },
              maxConcurrent: 1,
              models: [],
            },
          },
        },
      }),
    );
    const shim = join(root, "node-version.cjs");
    writeFileSync(
      shim,
      'Object.defineProperty(process.versions, "node", { value: "22.0.0" });\n',
    );
    stub(
      "node",
      `if [[ "$1" == --input-type=module ]]; then exec "$FIXTURE_NODE" --require "$FIXTURE_NODE_SHIM" "$@"; fi
[[ "$2 $3 $4" == 'server start --foreground' ]] || exit 2
printf 'server-start\\n' >> "$TRACE"`,
    );
    stub("uname", "printf 'Linux\\n'");
    stub(
      "id",
      'case "$1" in -u|-g) echo 1234 ;; -un|-gn) echo gwrk ;; *) exit 2 ;; esac',
    );
    writeFileSync(
      join(bin, "stat"),
      `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2); const file=args.at(-1);
const mode=(fs.statSync(file).mode & 0o777).toString(8);
const owner=JSON.parse(fs.readFileSync(process.env.FIXTURE_OWNERS,'utf8'))[file] || [0,1234];
const values={'%u':String(owner[0]),'%a':mode,'%a:%u:%g':mode+':'+owner[0]+':'+owner[1]};
if (!(args[1] in values)) process.exit(2); console.log(values[args[1]]);
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "realpath"),
      `#!${process.execPath}
console.log(require('node:fs').realpathSync(process.argv.at(-1)));
`,
      { mode: 0o755 },
    );
    stub("flock", "exit 0");
    stub(
      "timeout",
      '[[ "$1" == --kill-after=2s ]] || exit 2; shift 2; exec "$@"',
    );
    stub(
      "git",
      `if [[ "$*" == 'config --get remote.origin.url' ]]; then printf '%s\\n' "$GWRK_PILOT_REPO_URL"; else
[[ "$*" == "ls-remote --exit-code $GWRK_PILOT_REPO_URL HEAD" ]] || exit 2
printf 'git-ref\\n' >> "$TRACE"; fi`,
    );
    stub(
      "gh",
      `[[ "$*" == 'api --hostname github.com --method GET --silent repos/fixture/pilot/commits?per_page=1' ]] || exit 2
[[ "$GH_TOKEN" == synthetic-git-canary ]] || exit 2
printf 'git-auth\\n' >> "$TRACE"`,
    );
    stub(
      "agent-probe",
      `[[ "$1" == fixture ]] || exit 2
[[ "$(< "$GWRK_AGENT_CREDENTIAL_FILE")" == synthetic-agent-canary ]] || exit 2
printf 'provider-probe\\n' >> "$TRACE"`,
    );
    csrf = randomBytes(32).toString("base64url");
    writeFileSync(
      join(secrets, "google-account-allowlist"),
      "operator@gwrk.test\n",
      { mode: 0o640 },
    );
    writeFileSync(join(secrets, "csrf-hmac-key"), csrf, { mode: 0o640 });
    env = {
      PATH: `${bin}:/usr/bin:/bin`,
      GWRK_HOME: state,
      GWRK_RUNTIME_DIR: runtime,
      GWRK_RELEASE_ROOT: releaseRoot,
      GWRK_SECRETS_DIR: secrets,
      GWRK_PILOT_REPO: repo,
      GWRK_PILOT_REPO_URL: "https://github.com/fixture/pilot.git",
      GWRK_APPROVED_AGENT: "fixture",
      GWRK_AGENT_PROBE: join(bin, "agent-probe"),
      GWRK_LISTEN_HOST: "127.0.0.1",
      GWRK_LISTEN_PORT: "18790",
      GWRK_SLACK_ENABLED: "0",
      GWRK_AUTH_MODE: "hosted",
      GWRK_AUTH_PUBLIC_ORIGIN: "https://gwrk.gforge.ai",
      GWRK_AUTH_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
      GWRK_AUTH_GOOGLE_ALLOWLIST_FILE: join(
        secrets,
        "google-account-allowlist",
      ),
      GWRK_AUTH_CSRF_HMAC_FILE: join(secrets, "csrf-hmac-key"),
      FIXTURE_NODE: process.execPath,
      FIXTURE_NODE_SHIM: shim,
      FIXTURE_OWNERS: metadata,
      FIXTURE_SCRIPTS: scripts,
      TRACE: trace,
    };
  });
  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("refuses service launch when only outbound runner credentials exist and hosted auth configuration is absent", () => {
    for (const key of Object.keys(env))
      if (key.startsWith("GWRK_AUTH_")) delete env[key];
    rmSync(join(secrets, "google-account-allowlist"));
    rmSync(join(secrets, "csrf-hmac-key"));
    const result = execute(
      'bash "$FIXTURE_SCRIPTS/preflight.sh" && bash "$FIXTURE_SCRIPTS/run.sh"',
    );
    expect.soft(result.status, result.stderr).not.toBe(0);
    expect.soft(calls()).not.toContain("server-start");
    expect(result.stdout + result.stderr).not.toContain("synthetic-git-canary");
    expect(result.stdout + result.stderr).not.toContain(
      "synthetic-agent-canary",
    );
  });

  it("accepts complete hosted configuration through the existing bounded fixture probes", () => {
    const result = preflight();
    expect(result.status, result.stderr).toBe(0);
    expect(calls()).toEqual(["git-ref", "git-auth", "provider-probe"]);
    expect(result.stdout + result.stderr).not.toContain(csrf);
  });

  it("accepts a nonempty allowlist with case and surrounding whitespace normalization", () => {
    writeFileSync(
      join(secrets, "google-account-allowlist"),
      "  Operator@GWRK.TEST  \n\n",
    );
    expect(preflight().status).toBe(0);
  });

  it("keeps origin mapping for the origin without exporting raw CSRF material", () => {
    const result = execute(
      'source "$FIXTURE_SCRIPTS/credentials.sh"; load_runner_credentials; env',
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("GWRK_AUTH_MODE=hosted");
    expect(result.stdout).toContain(
      `GWRK_AUTH_CSRF_HMAC_FILE=${env.GWRK_AUTH_CSRF_HMAC_FILE}`,
    );
    expect(result.stdout).not.toContain(csrf);
  });

  it.each([
    "GWRK_AUTH_MODE",
    "GWRK_AUTH_PUBLIC_ORIGIN",
    "GWRK_AUTH_GOOGLE_CLIENT_ID",
    "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
    "GWRK_AUTH_CSRF_HMAC_FILE",
  ])("rejects absent required hosted setting %s", (key) => {
    delete env[key];
    expect(preflight().status).toBe(1);
  });

  it("does not select trusted-local mode for other hosted settings", () => {
    expect(preflight({ GWRK_AUTH_MODE: "trusted_local" }).status).toBe(1);
  });

  it("rejects a non-HTTPS public origin", () => {
    expect(
      preflight({ GWRK_AUTH_PUBLIC_ORIGIN: "http://gwrk.gforge.ai" }).status,
    ).toBe(1);
  });

  it.each(["0.0.0.0", "10.42.0.10"])(
    "rejects non-loopback hosted bind %s even when config and runner agree",
    (host) => {
      const configPath = join(env.GWRK_PILOT_REPO as string, ".gwrkrc.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.server.host = host;
      writeFileSync(configPath, JSON.stringify(config));
      expect(preflight({ GWRK_LISTEN_HOST: host }).status).toBe(1);
    },
  );

  for (const [setting, basename] of [
    ["GWRK_AUTH_GOOGLE_ALLOWLIST_FILE", "google-account-allowlist"],
    ["GWRK_AUTH_CSRF_HMAC_FILE", "csrf-hmac-key"],
  ]) {
    it(`rejects missing ${basename}`, () => {
      rmSync(join(secrets, basename));
      expect(preflight().status).toBe(1);
    });
    it(`rejects loose modes on ${basename}`, () => {
      chmodSync(join(secrets, basename), 0o644);
      expect(preflight().status).toBe(1);
    });
    it(`rejects non-root ownership on ${basename}`, () => {
      writeFileSync(
        metadata,
        JSON.stringify({ [join(secrets, basename)]: [1234, 1234] }),
      );
      expect(preflight().status).toBe(1);
    });
    it(`rejects the wrong service group on ${basename}`, () => {
      writeFileSync(
        metadata,
        JSON.stringify({ [join(secrets, basename)]: [0, 9999] }),
      );
      expect(preflight().status).toBe(1);
    });
    it(`rejects symlinked ${basename}`, () => {
      const source = join(secrets, basename);
      const destination = join(secrets, `original-${basename}`);
      writeFileSync(destination, readFileSync(source), { mode: 0o640 });
      rmSync(source);
      symlinkSync(destination, source);
      expect(preflight().status).toBe(1);
    });
    it(`rejects ${basename} outside the configured secrets root`, () => {
      const outside = join(root, `outside-${basename}`);
      writeFileSync(outside, readFileSync(join(secrets, basename)), {
        mode: 0o640,
      });
      expect(preflight({ [setting]: outside }).status).toBe(1);
    });
  }

  it.each(["", "  \n", "*@gwrk.test\n", "not-an-email\n"])(
    "rejects an unusable allowlist %j",
    (content) => {
      writeFileSync(join(secrets, "google-account-allowlist"), content);
      expect(preflight().status).toBe(1);
    },
  );

  it.each([
    "CANARY_CSRF_SHORT",
    `${"a".repeat(43)}!`,
    `${"a".repeat(20)} ${"a".repeat(23)}`,
  ])("rejects malformed CSRF material %j", (content) => {
    writeFileSync(join(secrets, "csrf-hmac-key"), content);
    const result = preflight();
    expect.soft(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(content);
  });

  it.each(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"])(
    "preserves Telegram denial for defined %s without provider or server effects",
    (name) => {
      const result = preflight({ [name]: "" });
      expect(result.status).toBe(1);
      expect(calls()).toEqual([]);
    },
  );

  it("preserves outbound credential loading without printing values", () => {
    const result = readAgentCredential();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
  it("preserves outbound credential mode enforcement using actual fixture mode bits", () => {
    chmodSync(join(secrets, "agent-credential"), 0o644);
    const result = readAgentCredential();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mode 0640");
  });
  it.each([
    [1234, 1234],
    [0, 9999],
  ])(
    "preserves credential ownership checks for UID %i and GID %i",
    (uid, gid) => {
      writeFileSync(
        metadata,
        JSON.stringify({ [join(secrets, "agent-credential")]: [uid, gid] }),
      );
      const result = readAgentCredential();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("owner root:gwrk");
    },
  );
  it("preserves outbound credential symlink denial", () => {
    const original = join(secrets, "agent-credential");
    const target = join(root, "synthetic-agent-value");
    writeFileSync(target, "synthetic-agent-canary", { mode: 0o640 });
    rmSync(original);
    symlinkSync(target, original);
    expect(readAgentCredential().status).toBe(1);
  });
});
