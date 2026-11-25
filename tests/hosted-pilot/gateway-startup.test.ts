/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const container = `gwrk-startup-barrier-${randomUUID()}`;
const bundle = "/fixture/bundle";
const clientId = "1234567890-startupfixture.apps.googleusercontent.com";
const tls = "/etc/gwrk/gateway-secrets/tls";
let started = false;

function shell(source: string) {
  return execFileSync("docker", ["exec", "-i", container, "bash", "-seu"], {
    input: source,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function launch(
  options: { args?: string[]; user?: string; environment?: string[] } = {},
) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      ...(options.user ? ["--user", options.user] : []),
      ...(options.environment ?? []).flatMap((value) => ["--env", value]),
      "--workdir",
      "/tmp",
      container,
      "bash",
      `${bundle}/run.sh`,
      ...(options.args ?? []),
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, output: result.stdout + result.stderr };
}

function invocations() {
  return JSON.parse(shell("cat /fixture/docker-calls.json")) as {
    args: string[];
    composeFile: string | null;
    composeProject: string | null;
    dockerHost: string | null;
    environment: Record<string, string>;
  }[];
}

beforeAll(() => {
  execFileSync(
    "docker",
    [
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
      "node:22-bookworm",
      "sleep",
      "infinity",
    ],
    { timeout: 30_000, stdio: "pipe" },
  );
  started = true;
  shell(`
    umask 077
    mkdir -p /fixture /fixture/bundle
    cd /fixture
    openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 365 -subj /CN=StartupFixtureRoot -keyout root.key -out root.crt >/dev/null 2>&1
    cp root.crt /usr/local/share/ca-certificates/gwrk-startup-fixture.crt
    update-ca-certificates >/dev/null 2>&1
    openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=StartupFixtureLeaf -keyout leaf.key -out leaf.csr >/dev/null 2>&1
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gwrk.gforge.ai\n' > leaf.ext
    openssl x509 -req -in leaf.csr -CA root.crt -CAkey root.key -CAcreateserial -days 30 -extfile leaf.ext -out leaf.crt >/dev/null 2>&1
    openssl x509 -req -in leaf.csr -CA root.crt -CAkey root.key -CAserial root.srl -days 6 -extfile leaf.ext -out near.crt >/dev/null 2>&1
    openssl x509 -req -in leaf.csr -CA root.crt -CAkey root.key -CAserial root.srl -days -1 -extfile leaf.ext -out expired.crt >/dev/null 2>&1
    openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -subj /CN=gwrk.gforge.ai -addext subjectAltName=DNS:gwrk.gforge.ai -keyout untrusted.key -out untrusted.crt >/dev/null 2>&1
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out mismatch.key >/dev/null 2>&1
    cat > /usr/bin/docker <<'STUB'
#!/usr/local/bin/node
const fs = require('node:fs');
const file = '/fixture/docker-calls.json';
const calls = JSON.parse(fs.readFileSync(file, 'utf8'));
calls.push({ args: process.argv.slice(2), composeFile: process.env.COMPOSE_FILE ?? null, composeProject: process.env.COMPOSE_PROJECT_NAME ?? null, dockerHost: process.env.DOCKER_HOST ?? null, environment: process.env });
fs.writeFileSync(file, JSON.stringify(calls));
process.exit(fs.existsSync('/fixture/docker-fail') ? 42 : 0);
STUB
    chmod 755 /usr/bin/docker
    chmod 755 /fixture /fixture/bundle
  `);
}, 60_000);

afterAll(() => {
  if (started)
    execFileSync("docker", ["rm", "--force", container], {
      timeout: 15_000,
      stdio: "pipe",
    });
});

beforeEach(() => {
  shell(`
    rm -rf /fixture/bundle /etc/gwrk /fixture/docker-fail
    mkdir -p /fixture/bundle
    chmod 755 /fixture/bundle
    cp /workspace/deploy/hosted-pilot/preflight-tls.sh /fixture/bundle/preflight-tls.sh
    if [[ -f /workspace/deploy/hosted-pilot/run.sh ]]; then
      cp /workspace/deploy/hosted-pilot/run.sh /fixture/bundle/run.sh
    fi
    chmod 755 /fixture/bundle/*
    printf 'services: {}\n' > /fixture/bundle/compose.yaml
    chmod 644 /fixture/bundle/compose.yaml
    printf 'GWRK_AUTH_GOOGLE_CLIENT_ID=${clientId}\n' > /fixture/bundle/.env
    chmod 644 /fixture/bundle/.env
    mkdir -p ${tls}
    chmod 700 /etc/gwrk /etc/gwrk/gateway-secrets ${tls}
    cat /fixture/leaf.crt /fixture/root.crt > ${tls}/fullchain.pem
    cp /fixture/leaf.key ${tls}/privkey.pem
    chmod 600 ${tls}/*
    printf '[]' > /fixture/docker-calls.json
    chmod 666 /fixture/docker-calls.json
  `);
});

describe("gateway startup component barrier with Linux root TLS and a Docker stub", () => {
  it("runs trusted preflight before one canonical compose launch from an unrelated cwd", () => {
    const result = launch();
    expect(result.status).toBe(0);
    expect(invocations()).toEqual([
      {
        args: [
          "--host",
          "unix:///var/run/docker.sock",
          "compose",
          "--project-name",
          "gwrk-hosted-pilot",
          "--project-directory",
          bundle,
          "--file",
          `${bundle}/compose.yaml`,
          "--env-file",
          `${bundle}/.env`,
          "up",
          "--detach",
        ],
        composeFile: null,
        composeProject: null,
        dockerHost: null,
        environment: {
          PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
          HOME: "/root",
          LANG: "C",
          LC_ALL: "C",
        },
      },
    ]);
  });

  it.each([
    ["missing certificate", `rm ${tls}/fullchain.pem`, "regular-file-required"],
    ["missing key", `rm ${tls}/privkey.pem`, "regular-file-required"],
    [
      "malformed certificate",
      `printf CANARY_PRIVATE_MATERIAL > ${tls}/fullchain.pem`,
      "certificate-chain-invalid",
    ],
    [
      "mismatched key",
      `cp /fixture/mismatch.key ${tls}/privkey.pem`,
      "key-mismatch",
    ],
    [
      "untrusted certificate",
      `cp /fixture/untrusted.crt ${tls}/fullchain.pem; cp /fixture/untrusted.key ${tls}/privkey.pem`,
      "trusted-server-chain",
    ],
    [
      "near expiration",
      `cat /fixture/near.crt /fixture/root.crt > ${tls}/fullchain.pem`,
      "validity-buffer",
    ],
    [
      "expired certificate",
      `cat /fixture/expired.crt /fixture/root.crt > ${tls}/fullchain.pem`,
      "validity-buffer",
    ],
    ["loose key mode", `chmod 644 ${tls}/privkey.pem`, "file-permissions"],
    [
      "wrong key owner",
      `chown 65534:65534 ${tls}/privkey.pem`,
      "file-permissions",
    ],
    ["loose TLS directory", `chmod 755 ${tls}`, "directory-permissions"],
    [
      "symlink key",
      `rm ${tls}/privkey.pem; ln -s /fixture/leaf.key ${tls}/privkey.pem`,
      "symlink-denied",
    ],
  ])(
    "prevents any Docker invocation with %s",
    (_label, mutation, condition) => {
      shell(mutation);
      const result = launch();
      expect(result.status).toBe(1);
      const basename =
        condition === "directory-permissions"
          ? "tls"
          : ["key-mismatch", "file-permissions", "symlink-denied"].includes(
                condition,
              ) || _label === "missing key"
            ? "privkey.pem"
            : "fullchain.pem";
      expect(result.output).toBe(`TLS preflight: ${condition} (${basename})\n`);
      expect(result.output).not.toMatch(
        /BEGIN |PRIVATE KEY|CANARY_PRIVATE_MATERIAL/,
      );
      expect(invocations()).toEqual([]);
    },
  );

  it("rejects nonroot execution before Docker launch", () => {
    const result = launch({ user: "65534:65534" });
    expect(result.status).toBe(1);
    expect(invocations()).toEqual([]);
  });

  it("rejects caller compose arguments without invoking Docker", () => {
    const result = launch({ args: ["--file", "/fixture/evil.yaml"] });
    expect(result.status).toBe(1);
    expect(result.output).toContain("arguments-denied");
    expect(invocations()).toEqual([]);
  });

  it("does not use inherited compose or Docker target selection", () => {
    const result = launch({
      environment: [
        "COMPOSE_FILE=/fixture/evil.yaml",
        "COMPOSE_PROJECT_NAME=other-project",
        "COMPOSE_ENV_FILES=/fixture/evil.env",
        "COMPOSE_PROFILES=unreviewed",
        "DOCKER_HOST=tcp://attacker.invalid:2375",
        "DOCKER_CONTEXT=other-context",
        "GWRK_AUTH_GOOGLE_CLIENT_ID=CANARY_INHERITED_CLIENT_OVERRIDE",
        "OAUTH2_PROXY_CLIENT_SECRET=CANARY_INHERITED_PROXY_SECRET",
      ],
    });
    expect(result.status).toBe(0);
    expect(invocations()[0]).toMatchObject({
      composeFile: null,
      composeProject: null,
      dockerHost: null,
    });
    expect(invocations()[0].args).toContain(`${bundle}/compose.yaml`);
    expect(invocations()[0].environment).toEqual({
      PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: "/root",
      LANG: "C",
      LC_ALL: "C",
    });
    expect(JSON.stringify(invocations())).not.toContain("CANARY_");
  });

  it("does not launch when the sibling preflight is missing", () => {
    shell(`rm ${bundle}/preflight-tls.sh`);
    const result = launch();
    expect(result.status).toBe(1);
    expect(invocations()).toEqual([]);
  });

  it("does not launch with a missing or symlinked compose bundle", () => {
    shell(
      `mv ${bundle}/compose.yaml /fixture/other-compose.yaml; ln -s /fixture/other-compose.yaml ${bundle}/compose.yaml`,
    );
    expect(launch().status).toBe(1);
    expect(invocations()).toEqual([]);
    shell(`rm ${bundle}/compose.yaml`);
    expect(launch().status).toBe(1);
    expect(invocations()).toEqual([]);
  });

  it.each([
    ["missing", `rm ${bundle}/.env`],
    [
      "symlink",
      `mv ${bundle}/.env /fixture/public.env; ln -s /fixture/public.env ${bundle}/.env`,
    ],
    ["wrong owner", `chown 65534:65534 ${bundle}/.env`],
    ["writable", `chmod 666 ${bundle}/.env`],
    [
      "duplicate",
      `cat ${bundle}/.env >> /fixture/duplicate.env; cat /fixture/duplicate.env >> ${bundle}/.env`,
    ],
    [
      "unknown key",
      `printf 'OAUTH2_PROXY_CLIENT_SECRET=CANARY_SECRET\\n' >> ${bundle}/.env`,
    ],
    [
      "shell expression",
      `printf 'GWRK_AUTH_GOOGLE_CLIENT_ID=$(touch /fixture/sourced)\\n' > ${bundle}/.env`,
    ],
    [
      "malformed client ID",
      `printf 'GWRK_AUTH_GOOGLE_CLIENT_ID=not-a-google-web-client\\n' > ${bundle}/.env`,
    ],
    ["oversized", `head -c 4097 /dev/zero > ${bundle}/.env`],
  ])(
    "rejects %s public config without invoking Docker or sourcing values",
    (_label, mutation) => {
      shell(`rm -f /fixture/sourced /fixture/duplicate.env; ${mutation}`);
      const result = launch();
      expect(result.status).toBe(1);
      expect(result.output).toBe("Gateway startup: public-config-invalid\n");
      expect(invocations()).toEqual([]);
      expect(shell("test ! -e /fixture/sourced; printf clean")).toBe("clean");
    },
  );

  it("propagates Docker failure instead of reporting a successful startup", () => {
    shell("touch /fixture/docker-fail");
    expect(launch().status).toBe(42);
    expect(invocations()).toHaveLength(1);
  });
});
