/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const container = `gwrk-tls-preflight-${randomUUID()}`;
const script = "/workspace/deploy/hosted-pilot/preflight-tls.sh";
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

function preflight(user?: string) {
  const result = spawnSync(
    "docker",
    ["exec", ...(user ? ["--user", user] : []), container, "bash", script],
    { encoding: "utf8", timeout: 12_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return { status: result.status, output: result.stdout + result.stderr };
}

function denied(condition: string, basename: string, user?: string) {
  const result = preflight(user);
  expect(result.status).toBe(1);
  expect(result.output).toBe(`TLS preflight: ${condition} (${basename})\n`);
  expect(result.output).not.toMatch(
    /BEGIN |PRIVATE KEY|CANARY|\/etc\/|password|pass phrase/i,
  );
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
  mkdir -p /fixture/newcerts
  cd /fixture
  openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 365 -subj /CN=PrivateFixtureRoot -keyout root.key -out root.crt >/dev/null 2>&1
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=PrivateFixtureIntermediate -keyout intermediate.key -out intermediate.csr >/dev/null 2>&1
  printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n' > intermediate.ext
  openssl x509 -req -in intermediate.csr -CA root.crt -CAkey root.key -CAcreateserial -days 100 -extfile intermediate.ext -out intermediate.crt >/dev/null 2>&1
  openssl x509 -req -in intermediate.csr -CA root.crt -CAkey root.key -CAserial root.srl -days 6 -extfile intermediate.ext -out near-intermediate.crt >/dev/null 2>&1
  cp root.crt /usr/local/share/ca-certificates/gwrk-private-fixture.crt
  update-ca-certificates >/dev/null 2>&1
  : > index.txt
  echo 1000 > serial
  cat > ca.cnf <<'CONFIG'
[ca]
default_ca=fixture
[fixture]
database=/fixture/index.txt
new_certs_dir=/fixture/newcerts
certificate=/fixture/intermediate.crt
private_key=/fixture/intermediate.key
serial=/fixture/serial
default_md=sha256
policy=policy
unique_subject=no
[policy]
commonName=supplied
CONFIG
  issue() {
    name=$1
    start=$2
    end=$3
    host=$4
    purpose=$5
    openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj /CN=FixtureLeaf -keyout "$name.key" -out "$name.csr" >/dev/null 2>&1
    printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=%s\nsubjectAltName=DNS:%s\n' "$purpose" "$host" > "$name.ext"
    openssl ca -batch -notext -config ca.cnf -startdate "$(date -u -d "$start" +%Y%m%d%H%M%SZ)" -enddate "$(date -u -d "$end" +%Y%m%d%H%M%SZ)" -extfile "$name.ext" -in "$name.csr" -out "$name.crt" >/dev/null 2>&1
    cat "$name.crt" intermediate.crt > "$name.fullchain"
  }
  issue valid '1 day ago' '30 days' gwrk.gforge.ai serverAuth
  issue expired '30 days ago' '1 day ago' gwrk.gforge.ai serverAuth
  issue near '1 day ago' '6 days' gwrk.gforge.ai serverAuth
  issue future '1 day' '30 days' gwrk.gforge.ai serverAuth
  issue wronghost '1 day ago' '30 days' other.example.test serverAuth
  issue wrongpurpose '1 day ago' '30 days' gwrk.gforge.ai clientAuth
  openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 -subj /CN=gwrk.gforge.ai -addext subjectAltName=DNS:gwrk.gforge.ai -keyout untrusted.key -out untrusted.fullchain >/dev/null 2>&1
  openssl pkey -in valid.key -aes-256-cbc -passout pass:CANARY_TEST_ONLY -out encrypted.key >/dev/null 2>&1
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
  shell(
    `rm -rf /etc/gwrk; install -d -m 0755 /etc/gwrk; install -d -m 0700 /etc/gwrk/gateway-secrets ${tls}; install -m 0600 /fixture/valid.fullchain ${tls}/fullchain.pem; install -m 0600 /fixture/valid.key ${tls}/privkey.pem`,
  );
});

describe("hosted TLS preflight in isolated Linux root container", () => {
  it("accepts a trusted canonical full chain and matching key with seven days remaining", () => {
    const result = preflight();
    expect(result.status).toBe(0);
    expect(result.output).toBe("");
  });
  it("requires root instead of trusting a caller-supplied identity", () => {
    denied("root-required", "tls", "65534:65534");
  });
  it.each(["gateway-secrets", "tls"])(
    "rejects missing %s directory",
    (directory) => {
      shell(
        `rm -rf /etc/gwrk/gateway-secrets${directory === "tls" ? "/tls" : ""}`,
      );
      denied("directory-required", directory);
    },
  );
  it.each(["gateway-secrets", "tls"])(
    "rejects symlinked %s directory",
    (directory) => {
      const path = directory === "tls" ? tls : "/etc/gwrk/gateway-secrets";
      shell(
        `mv ${path} /fixture/link-target; ln -s /fixture/link-target ${path}`,
      );
      try {
        denied("symlink-denied", directory);
      } finally {
        shell("rm -rf /fixture/link-target");
      }
    },
  );
  it.each(["gateway-secrets", "tls"])(
    "rejects unsafe %s directory mode",
    (directory) => {
      shell(
        `chmod 0755 /etc/gwrk/gateway-secrets${directory === "tls" ? "/tls" : ""}`,
      );
      denied("directory-permissions", directory);
    },
  );
  it.each(["gateway-secrets", "tls"])(
    "rejects non-root %s directory ownership",
    (directory) => {
      shell(
        `chown 65534:65534 /etc/gwrk/gateway-secrets${directory === "tls" ? "/tls" : ""}`,
      );
      denied("directory-permissions", directory);
    },
  );
  it.each(["fullchain.pem", "privkey.pem"])(
    "rejects missing %s",
    (basename) => {
      shell(`rm ${tls}/${basename}`);
      denied("regular-file-required", basename);
    },
  );
  it.each(["fullchain.pem", "privkey.pem"])(
    "rejects symlinked %s",
    (basename) => {
      shell(
        `mv ${tls}/${basename} ${tls}/${basename}.real; ln -s ${basename}.real ${tls}/${basename}`,
      );
      denied("symlink-denied", basename);
    },
  );
  it.each(["fullchain.pem", "privkey.pem"])(
    "rejects non-regular %s without blocking",
    (basename) => {
      shell(`rm ${tls}/${basename}; mkfifo -m 0600 ${tls}/${basename}`);
      denied("regular-file-required", basename);
    },
  );
  it.each(["fullchain.pem", "privkey.pem"])(
    "rejects unsafe %s mode",
    (basename) => {
      shell(`chmod 0640 ${tls}/${basename}`);
      denied("file-permissions", basename);
    },
  );
  it.each(["fullchain.pem", "privkey.pem"])(
    "rejects non-root %s ownership",
    (basename) => {
      shell(`chown 65534:65534 ${tls}/${basename}`);
      denied("file-permissions", basename);
    },
  );
  it.each([
    "expired",
    "near",
    "future",
    "wronghost",
    "wrongpurpose",
    "untrusted",
  ])("rejects %s real certificate", (variant) => {
    shell(
      `install -m 0600 /fixture/${variant}.fullchain ${tls}/fullchain.pem; install -m 0600 /fixture/${variant}.key ${tls}/privkey.pem`,
    );
    denied(
      variant === "near" || variant === "expired"
        ? "validity-buffer"
        : "trusted-server-chain",
      "fullchain.pem",
    );
  });
  it("rejects a matching hostname with a missing intermediate", () => {
    shell(`install -m 0600 /fixture/valid.crt ${tls}/fullchain.pem`);
    denied("trusted-server-chain", "fullchain.pem");
  });
  it("rejects a short-lived intermediate even when the trusted chain and long-lived leaf are valid now", () => {
    shell(
      `cat /fixture/valid.crt /fixture/near-intermediate.crt > ${tls}/fullchain.pem; openssl x509 -in /fixture/valid.crt -checkend 604800 -noout >/dev/null; openssl verify -purpose sslserver -verify_hostname gwrk.gforge.ai -untrusted ${tls}/fullchain.pem ${tls}/fullchain.pem >/dev/null`,
    );
    denied("validity-buffer", "fullchain.pem");
  });
  it("rejects mismatched public keys", () => {
    shell(`install -m 0600 /fixture/wronghost.key ${tls}/privkey.pem`);
    denied("key-mismatch", "privkey.pem");
  });
  it("rejects encrypted keys without prompting or exposing the passphrase", () => {
    shell(`install -m 0600 /fixture/encrypted.key ${tls}/privkey.pem`);
    denied("private-key-invalid", "privkey.pem");
  });
  it("rejects malformed keys without reflecting sensitive material", () => {
    shell(`printf '%s\\n' CANARY_PRIVATE_KEY_MATERIAL > ${tls}/privkey.pem`);
    denied("private-key-invalid", "privkey.pem");
  });
  it("parses every certificate rather than accepting a valid leaf with a malformed chain tail", () => {
    shell(
      `printf '\\n-----BEGIN CERTIFICATE-----\\nCANARY_INVALID_CERTIFICATE\\n-----END CERTIFICATE-----\\n' >> ${tls}/fullchain.pem`,
    );
    denied("certificate-chain-invalid", "fullchain.pem");
  });
  it("rejects malformed certificate input without echoing it", () => {
    shell(`printf '%s\\n' CANARY_CERTIFICATE_MATERIAL > ${tls}/fullchain.pem`);
    denied("certificate-chain-invalid", "fullchain.pem");
  });
});
