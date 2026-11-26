/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
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
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const root = "deploy/linux-runner";
const read = (name: string) => readFileSync(`${root}/${name}`, "utf8");

function runnerFixture(run: (fixture: string, bin: string) => void) {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-runner-")));
  try {
    const bin = join(fixture, "bin");
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, "node"));
    run(fixture, bin);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function stub(bin: string, name: string, body: string) {
  rmSync(join(bin, name), { force: true });
  writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, {
    mode: 0o755,
    flag: "wx",
  });
}

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

  it("requires accepted credentials and an installed approved backend", () => {
    runnerFixture((fixture, bin) => {
      const state = join(fixture, "state");
      const runtime = join(fixture, "runtime");
      const releaseRoot = join(fixture, "opt");
      const release = join(releaseRoot, "releases/candidate");
      const secrets = join(fixture, "secrets");
      const repo = join(state, "repos/pilot");
      const plugin = join(state, "plugins/agents/fixture");
      const trace = join(fixture, "calls");
      for (const dir of [runtime, release, secrets, repo, plugin]) {
        mkdirSync(dir, { recursive: true });
      }
      symlinkSync(release, join(releaseRoot, "current"));
      symlinkSync(join(process.cwd(), "dist"), join(release, "dist"));
      writeFileSync(
        join(plugin, "manifest.yaml"),
        `type: agent
name: fixture
version: 1.0.0
description: Synthetic Linux runner backend
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
  name: "fixture",
  async isAvailable() { return true; },
  async dispatch() { return { command: "agent-probe", args: ["fixture"] }; },
  parseResult(stdout, stderr, exitCode) { return { stdout, stderr, exitCode }; },
};
`,
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
      const versionShim = join(fixture, "node-version.cjs");
      writeFileSync(
        versionShim,
        'Object.defineProperty(process.versions, "node", { value: process.env.FIXTURE_NODE_VERSION });\n',
      );
      stub(
        bin,
        "node",
        'exec "$FIXTURE_NODE_EXECUTABLE" --require "$FIXTURE_NODE_VERSION_SHIM" "$@"',
      );
      stub(bin, "uname", "printf 'Linux\\n'");
      stub(
        bin,
        "id",
        `case "$1" in -u|-g) echo 1234 ;; -un|-gn) echo gwrk ;; *) exit 2 ;; esac`,
      );
      stub(
        bin,
        "stat",
        `case "$2" in '%u') echo 0 ;; '%a') echo 755 ;; '%a:%u:%g') echo 640:0:1234 ;; *) exit 2 ;; esac`,
      );
      writeFileSync(
        join(bin, "realpath"),
        `#!${process.execPath}\nconsole.log(require("node:fs").realpathSync(process.argv.at(-1)));\n`,
        { mode: 0o755 },
      );
      stub(bin, "flock", "exit 0");
      stub(
        bin,
        "timeout",
        `
[[ "$1" == --kill-after=2s ]] || exit 2
case "$3" in
  node|git|gh) [[ "$2" == 20s ]] || exit 2 ;;
  */agent-probe) [[ "$2" == 30s ]] || exit 2 ;;
  *) exit 2 ;;
esac
printf 'timeout:%s:%s\\n' "\${3##*/}" "$2" >> "$TRACE"
shift 2
exec "$@"`,
      );
      stub(
        bin,
        "git",
        `
if [[ "$*" == 'config --get remote.origin.url' ]]; then
  printf '%s\\n' "$GWRK_PILOT_REPO_URL"
else
  [[ "$*" == "ls-remote --exit-code $GWRK_PILOT_REPO_URL HEAD" && "$GIT_TERMINAL_PROMPT" == 0 ]]
  printf 'ref\\n' >> "$TRACE"
  printf '0000000000000000000000000000000000000001\\tHEAD\\n'
fi`,
      );
      stub(
        bin,
        "gh",
        `
[[ "$*" == 'api --hostname github.com --method GET --silent repos/fixture/pilot/commits?per_page=1' ]]
[[ "$GH_PROMPT_DISABLED" == 1 ]]
printf 'api\\n' >> "$TRACE"
if [[ "$GH_TOKEN" != accepted ]]; then
  printf 'Rejected credential %s\\n' "$GH_TOKEN" >&2
  exit 1
fi`,
      );
      stub(
        bin,
        "agent-probe",
        `[[ "$1" == fixture && "$(< "$GWRK_AGENT_CREDENTIAL_FILE")" == agent-token ]]`,
      );
      writeFileSync(join(secrets, "agent-credential"), "agent-token\n");
      const allowlistFile = join(secrets, "google-account-allowlist");
      const csrfHmacFile = join(secrets, "csrf-hmac-key");
      const csrfHmacCanary = randomBytes(32).toString("base64url");
      writeFileSync(allowlistFile, "operator@gwrk.test\n", { mode: 0o640 });
      chmodSync(allowlistFile, 0o640);
      writeFileSync(csrfHmacFile, `${csrfHmacCanary}\n`, { mode: 0o640 });
      chmodSync(csrfHmacFile, 0o640);

      const preflight = (
        suffix: string,
        nodeVersion = "22.0.0",
        extraEnv: Record<string, string | undefined> = {},
      ) => {
        const env: NodeJS.ProcessEnv = {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: state,
          GIT_EDITOR: "true",
          EDITOR: "true",
          GH_TOKEN: "inherited-token",
          GWRK_HOME: state,
          GWRK_RUNTIME_DIR: runtime,
          GWRK_RELEASE_ROOT: releaseRoot,
          GWRK_SECRETS_DIR: secrets,
          GWRK_PILOT_REPO: repo,
          GWRK_PILOT_REPO_URL: `https://github.com/fixture/pilot${suffix}`,
          GWRK_APPROVED_AGENT: "fixture",
          GWRK_AGENT_PROBE: join(bin, "agent-probe"),
          GWRK_LISTEN_HOST: "127.0.0.1",
          GWRK_LISTEN_PORT: "18790",
          GWRK_AUTH_MODE: "hosted",
          GWRK_AUTH_PUBLIC_ORIGIN: "https://gwrk.gforge.ai",
          GWRK_AUTH_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
          GWRK_AUTH_GOOGLE_ALLOWLIST_FILE: allowlistFile,
          GWRK_AUTH_CSRF_HMAC_FILE: csrfHmacFile,
          TRACE: trace,
          FIXTURE_NODE_VERSION: nodeVersion,
          FIXTURE_NODE_EXECUTABLE: process.execPath,
          FIXTURE_NODE_VERSION_SHIM: versionShim,
        };
        for (const [key, value] of Object.entries(extraEnv)) {
          if (value === undefined) delete env[key];
          else env[key] = value;
        }
        return spawnSync("bash", [`${root}/preflight.sh`], {
          env,
          encoding: "utf8",
          timeout: 5000,
        });
      };
      writeFileSync(join(secrets, "pilot-git-credential"), "accepted\n");
      writeFileSync(trace, "");
      const missingAuthMode = preflight(".git", "22.0.0", {
        GWRK_AUTH_MODE: undefined,
      });
      expect(missingAuthMode.status).toBe(1);
      expect(missingAuthMode.stderr).toContain("Set GWRK_AUTH_MODE.");
      expect(readFileSync(trace, "utf8").trim()).toBe("");
      expect(missingAuthMode.stdout + missingAuthMode.stderr).not.toContain(
        csrfHmacCanary,
      );

      for (const version of ["18.0.0", "20.0.0"]) {
        writeFileSync(trace, "");
        const unsupported = preflight(".git", version);
        expect.soft(unsupported.status, unsupported.stderr).toBe(1);
        expect
          .soft(unsupported.stderr)
          .toContain("Node.js 22 or newer is required");
        expect
          .soft(readFileSync(trace, "utf8").trim().split("\n"))
          .toEqual(["timeout:node:20s"]);
      }

      for (const [token, suffix, status] of [
        ["revoked", ".git", 1],
        ["accepted", ".git", 0],
        ["accepted", "", 0],
      ] as const) {
        writeFileSync(trace, "");
        writeFileSync(join(secrets, "pilot-git-credential"), `${token}\n`);
        const result = preflight(suffix);
        expect(result.status, result.stderr).toBe(status);
        const expectedCalls = [
          "timeout:node:20s",
          "timeout:git:20s",
          "ref",
          "timeout:gh:20s",
          "api",
        ];
        if (status === 0) expectedCalls.push("timeout:agent-probe:30s");
        expect(
          readFileSync(trace, "utf8").trim().split("\n"),
          result.stderr,
        ).toEqual(expectedCalls);
        expect(result.stdout + result.stderr).not.toContain(token);
        expect(status === 1 ? result.stderr : result.stdout).toContain(
          status === 1 ? "Pilot Git authentication failed" : "preflight passed",
        );
      }

      const adapterPath = join(plugin, "adapter.js");
      const availableAdapter = readFileSync(adapterPath, "utf8");
      writeFileSync(
        adapterPath,
        availableAdapter.replace(
          "async isAvailable() { return true; }",
          "async isAvailable() { return false; }",
        ),
      );
      const unavailableWorker = preflight(".git");
      expect(unavailableWorker.status, unavailableWorker.stdout).toBe(1);
      expect(unavailableWorker.stderr).toMatch(/fixture.*unavailable/i);
      writeFileSync(adapterPath, availableAdapter);

      rmSync(join(plugin, "adapter.js"));
      const missingAdapter = preflight(".git");
      expect(missingAdapter.status, missingAdapter.stdout).toBe(1);
      expect(missingAdapter.stderr).toContain(
        "Agent backend 'fixture' not found.",
      );

      rmSync(plugin, { recursive: true });
      const missingBackend = preflight(".git");
      expect(missingBackend.status, missingBackend.stdout).toBe(1);
      expect(missingBackend.stderr).toMatch(/backend.*fixture/i);
    });
  });

  it("runs the documented install and ledger commands with no gwrk executable", () => {
    runnerFixture((fixture, bin) => {
      const readme = read("README.md");
      const state = join(fixture, "var/lib/gwrk");
      const runtime = join(fixture, "run/gwrk");
      const pilot = join(state, "repos/pilot");
      const backup = join(fixture, "backup");
      const restored = join(fixture, "restored");
      const installedCli = join(fixture, "opt/gwrk/current/dist/cli.js");
      for (const dir of [
        pilot,
        runtime,
        join(fixture, "etc/gwrk"),
        join(fixture, "opt/gwrk"),
      ]) {
        mkdirSync(dir, { recursive: true });
      }
      symlinkSync(process.cwd(), join(fixture, "opt/gwrk/current"));
      execFileSync("git", ["init", "--quiet", pilot]);
      for (const source of ["probe", "git-token", "agent-token"]) {
        writeFileSync(join(fixture, source), `${source}\n`);
      }
      writeFileSync(
        join(fixture, "linux.cjs"),
        'Object.defineProperty(process, "platform", { value: "linux" });\n',
      );
      stub(
        bin,
        "runuser",
        `
[[ "$1" == -u && "$2" == gwrk && "$3" == -- ]]
if [[ "$4" == git ]]; then
  [[ "$5" == -C && "$6" == "$HOME/repos/pilot" && "$7" == config ]]
  [[ "$8" == user.name || "$8" == user.email ]]
  shift 3
  exec "$@"
fi
[[ "$4" == env ]]
[[ "$5" == "GWRK_HOME=$HOME" && "$6" == "GWRK_RUNTIME_DIR=$RUNTIME" ]]
[[ "$7" == node && "$8" == "$CLI" ]]
if [[ "$9" == init ]]; then [[ "$PWD" == "$HOME/repos/pilot" ]]; fi
if [[ "$9" == db && "\${10:-}" == restore ]]; then
  export NODE_OPTIONS="--require=\"$FIXTURE/linux.cjs\""
fi
shift 3
exec "$@"`,
      );
      stub(
        bin,
        "install",
        `
args=()
while (( $# )); do
  case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
done
exec /usr/bin/install "\${args[@]}"`,
      );
      stub(
        bin,
        "systemctl",
        `
case "$*" in
  'daemon-reload'|'stop gwrk-runner.service') ;;
  'enable --now gwrk-runner.service')
    [[ -x "$FIXTURE/usr/local/libexec/gwrk-agent-probe" ]]
    git -C "$HOME/repos/pilot" -c user.useConfigOnly=true var GIT_AUTHOR_IDENT >/dev/null
    git -C "$HOME/repos/pilot" -c user.useConfigOnly=true var GIT_COMMITTER_IDENT >/dev/null
    cmp "$PILOT_GIT_CREDENTIAL_SOURCE" "$FIXTURE/etc/gwrk/secrets/pilot-git-credential"
    cmp "$AGENT_CREDENTIAL_SOURCE" "$FIXTURE/etc/gwrk/secrets/agent-credential"
    touch "$FIXTURE/enabled"
    ;;
  *) exit 2 ;;
esac`,
      );
      stub(bin, "flock", `[[ "$*" == '-x -n -E 75 3' ]]`);
      const path = `${bin}:/usr/bin:/bin`;
      const shell = (commands: string) => {
        const localCommands = commands.replace(
          /\/(?:var\/lib\/gwrk|run\/gwrk|opt\/gwrk|etc\/gwrk|usr\/local\/libexec)/g,
          (prefix) => `${fixture}${prefix}`,
        );
        return execFileSync(
          "/bin/bash",
          ["-ec", `if command -v gwrk; then exit 1; fi\n${localCommands}`],
          {
            cwd: fixture,
            env: {
              PATH: path,
              HOME: state,
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: join(fixture, "empty-gitconfig"),
              RUNNER_GIT_NAME: "Synthetic runner",
              RUNNER_GIT_EMAIL: "runner@example.invalid",
              GIT_EDITOR: "true",
              EDITOR: "true",
              AGENT_PROBE_SOURCE: join(fixture, "probe"),
              PILOT_GIT_CREDENTIAL_SOURCE: join(fixture, "git-token"),
              AGENT_CREDENTIAL_SOURCE: join(fixture, "agent-token"),
              BACKUP_DIR: backup,
              STATE_DIR: restored,
              FIXTURE: fixture,
              RUNTIME: runtime,
              CLI: installedCli,
            },
            timeout: 10_000,
            encoding: "utf8",
          },
        );
      };
      const codeBlocks = (section: string) =>
        [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map(
          (match) => match[1],
        );
      const [install, ledger] = readme.split("## Backup and rollback");
      const installCommands = codeBlocks(install);
      expect(
        installCommands.some((block) =>
          block.includes("init --non-interactive"),
        ),
        "The runbook must give a non-interactive init command.",
      ).toBe(true);
      shell(installCommands.join("\n"));
      expect(readFileSync(join(fixture, "enabled"), "utf8")).toBe("");
      expect(
        JSON.parse(readFileSync(join(state, "device.json"), "utf8")).role,
      ).toBe("server");

      execFileSync(
        process.execPath,
        [
          installedCli,
          "db",
          "record",
          "--feature",
          "runbook-sentinel",
          "--command",
          "ship",
        ],
        {
          cwd: pilot,
          env: {
            PATH: path,
            HOME: state,
            GWRK_HOME: state,
            GWRK_RUNTIME_DIR: runtime,
            GIT_EDITOR: "true",
            EDITOR: "true",
          },
          timeout: 10_000,
        },
      );
      const [backupCommands, restoreCommands] = codeBlocks(ledger);
      shell(backupCommands);
      shell(restoreCommands);
      for (const dir of [backup, restored]) {
        const db = new Database(join(dir, "gwrk.db"), {
          readonly: true,
          fileMustExist: true,
        });
        try {
          expect(
            db.prepare("SELECT feature_id FROM runs").pluck().all(),
          ).toEqual(["runbook-sentinel"]);
        } finally {
          db.close();
        }
      }
    });
  }, 20_000);

  it("documents repository-scoped write permissions for worker branches and pull requests", () => {
    const runbook = read("README.md");
    expect(runbook).toMatch(/Contents[^.\n]*read and write/i);
    expect(runbook).toMatch(/Pull requests[^.\n]*read and write/i);
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
