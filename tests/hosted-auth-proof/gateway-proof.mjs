import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(fixtures, "../../deploy/hosted-auth-proof");
const tmp = mkdtempSync(path.join(os.tmpdir(), "gwrk-auth-proof-"));
const project = `gwrk-proof-${randomBytes(5).toString("hex")}`;
const origin = "https://gwrk.gforge.ai";
const proof = '{"service":"gwrk-auth-proof","status":"ok"}';
const env = {
  ...process.env,
  GWRK_PROOF_TEST_DIR: tmp,
  GWRK_PROOF_TEST_FIXTURES: fixtures,
  GWRK_PROOF_ACME_EMAIL: "fixture@example.invalid",
  GWRK_PROOF_GOOGLE_CLIENT_ID: "fixture.apps.googleusercontent.com",
};

function compose(...args) {
  return execFileSync(
    "docker",
    [
      "compose",
      "--project-name",
      project,
      "-f",
      path.join(bundle, "compose.yaml"),
      "-f",
      path.join(fixtures, "compose.test.yaml"),
      ...args,
    ],
    { env, encoding: "utf8", timeout: 120_000 },
  );
}

function write(name, value) {
  writeFileSync(path.join(tmp, name), value, { mode: 0o644 });
}

function port(service, containerPort) {
  return compose("port", service, containerPort).trim().split(":").at(-1);
}

function request(url, jar, ...options) {
  const response = execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--noproxy",
      "*",
      "--max-time",
      "8",
      "--include",
      "--cacert",
      path.join(tmp, "cert.pem"),
      "--connect-to",
      `gwrk.gforge.ai:443:127.0.0.1:${httpsPort}`,
      "--connect-to",
      `gwrk.gforge.ai:80:127.0.0.1:${httpPort}`,
      "--connect-to",
      `issuer:8081:127.0.0.1:${issuerPort}`,
      ...(jar ? ["--cookie", jar, "--cookie-jar", jar] : []),
      ...options,
      url,
    ],
    { encoding: "utf8" },
  );
  const boundary = response.indexOf("\r\n\r\n");
  const lines = response.slice(0, boundary).split("\r\n");
  const status = Number(lines[0].split(" ")[1]);
  const values = (header) =>
    lines
      .filter((line) =>
        line.toLowerCase().startsWith(`${header.toLowerCase()}:`),
      )
      .map((line) => line.slice(line.indexOf(":") + 1).trim());
  return {
    status,
    values,
    location: values("location")[0],
    body: response.slice(boundary + 4),
  };
}

function denied(response, expectedStatuses = [302, 401, 403]) {
  assert(
    expectedStatuses.includes(response.status),
    `expected denial, received ${response.status}`,
  );
  assert(!response.body.includes(proof), "denial disclosed proof");
}

function signIn(
  identity,
  jar,
  { target = "/status", changeState = false } = {},
) {
  const start = request(new URL(target, origin).href, jar);
  assert.equal(start.status, 302);
  const auth = request(new URL(start.location, origin).href, jar);
  assert.equal(auth.status, 302);
  const issuer = new URL(auth.location);
  assert.equal(issuer.origin, "http://issuer:8081");
  assert.equal(
    issuer.searchParams.get("redirect_uri"),
    `${origin}/oauth2/callback`,
  );
  issuer.searchParams.set("fixture_user", identity);
  const redirect = request(issuer.href);
  assert.equal(redirect.status, 302);
  const callback = new URL(redirect.location);
  if (changeState) callback.searchParams.set("state", "tampered:%2Fstatus");
  return request(callback.href, jar);
}

function assertStatus(jar, target = "/status") {
  const response = request(`${origin}${target}`, jar);
  assert.equal(response.status, 200);
  assert.equal(response.body.trim(), proof);
  assert.equal(response.values("cache-control")[0], "no-store");
  assert.match(response.values("content-type")[0], /^application\/json/);
}

let httpsPort;
let httpPort;
let issuerPort;
try {
  chmodSync(tmp, 0o755);
  write("google-client-secret", "fixture-client-secret");
  write("cookie-secret", randomBytes(32).toString("base64url"));
  write("allowed-emails", "allowed@example.invalid\n");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-days",
      "1",
      "-subj",
      "/CN=gwrk.gforge.ai",
      "-addext",
      "subjectAltName=DNS:gwrk.gforge.ai",
      "-keyout",
      path.join(tmp, "key.pem"),
      "-out",
      path.join(tmp, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  write(
    "tls.yaml",
    "tls:\n  certificates:\n    - certFile: /tls/cert.pem\n      keyFile: /tls/key.pem\n",
  );

  compose("up", "-d");
  httpsPort = port("traefik", "443");
  httpPort = port("traefik", "80");
  issuerPort = port("issuer", "8081");
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      ready = request(`${origin}/status`).status === 302;
    } catch {
      ready = false;
    }
    if (ready) break;
    await sleep(500);
  }
  assert(ready, "the edge never reached the unauthenticated sign-in redirect");

  const httpRedirect = request("http://gwrk.gforge.ai/status");
  assert([301, 308].includes(httpRedirect.status));
  assert.equal(httpRedirect.location, `${origin}/status`);
  denied(
    request(
      `${origin}/status`,
      undefined,
      "-H",
      "X-Auth-Request-User: allowed@example.invalid",
      "-H",
      "X-Forwarded-Email: allowed@example.invalid",
      "-H",
      "Authorization: Bearer forged",
    ),
  );
  for (const route of [
    "/health",
    "/dispatch",
    "/notify",
    "/github",
    "/oauth2/auth",
    "/oauth2/userinfo",
  ]) {
    denied(request(`${origin}${route}`), [404]);
  }

  for (const identity of ["unlisted", "unverified", "bad-audience"]) {
    const rejectedBrowser = path.join(tmp, identity);
    denied(signIn(identity, rejectedBrowser), [403]);
    denied(request(`${origin}/status`, rejectedBrowser));
  }
  denied(
    signIn("allowed", path.join(tmp, "state"), { changeState: true }),
    [403],
  );

  const browser = path.join(tmp, "browser");
  const allowed = signIn("allowed", browser);
  assert.equal(allowed.status, 302);
  assert.equal(allowed.location, "/status");
  const cookie = allowed
    .values("set-cookie")
    .find((value) => value.startsWith("__Host-gwrk_proof="));
  assert(cookie, "OAuth2 Proxy did not issue a session cookie");
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /; HttpOnly/i);
  assert.match(cookie, /; SameSite=Lax/i);
  assert(!/; Domain=/i.test(cookie));
  assertStatus(browser);
  assertStatus(browser, "/");
  denied(request(`${origin}/status`, browser, "-X", "POST"), [405]);
  const session = cookie.split(";")[0];
  const signedOut = request(`${origin}/oauth2/sign_out?rd=%2F`, browser);
  assert.equal(signedOut.status, 302);
  denied(request(`${origin}/status`, browser));

  const revoked = path.join(tmp, "revoked");
  assert.equal(signIn("allowed", revoked).status, 302);
  assertStatus(revoked);
  write("allowed-emails.next", "other@example.invalid\n");
  renameSync(
    path.join(tmp, "allowed-emails.next"),
    path.join(tmp, "allowed-emails"),
  );
  const revocationStarted = Date.now();
  compose("restart", "oauth2-proxy");
  let revokedStatus;
  while (Date.now() - revocationStarted < 8_000) {
    revokedStatus = request(`${origin}/status`, revoked);
    if ([302, 401, 403].includes(revokedStatus.status)) break;
    await sleep(200);
  }
  denied(revokedStatus);
  assert(
    Date.now() - revocationStarted < 8_000,
    "allowlist revocation exceeded eight seconds after restart",
  );

  write("allowed-emails.next", "allowed@example.invalid\n");
  renameSync(
    path.join(tmp, "allowed-emails.next"),
    path.join(tmp, "allowed-emails"),
  );
  compose("restart", "oauth2-proxy");
  await sleep(13_000);
  const fresh = path.join(tmp, "fresh");
  assert.equal(signIn("allowed", fresh).status, 302);
  assertStatus(fresh);
  denied(request(`${origin}/status`, undefined, "-H", `Cookie: ${session}`));

  assert.throws(
    () => compose("port", "status", "8080"),
    "the origin published a host port",
  );
  assert.throws(
    () => compose("port", "oauth2-proxy", "4180"),
    "the OAuth2 Proxy published a host port",
  );
  const statusId = compose("ps", "-q", "status").trim();
  const statusIp = execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
      statusId,
    ],
    { encoding: "utf8" },
  ).trim();
  assert.match(statusIp, /^\d+\.\d+\.\d+\.\d+$/);
  compose(
    "exec",
    "-T",
    "issuer",
    "node",
    "-e",
    `
    fetch("http://" + process.argv[1] + ":8080/status", { signal: AbortSignal.timeout(1500) })
      .then(() => process.exit(1), () => process.exit(0));
  `,
    statusIp,
  );
  compose("stop", "oauth2-proxy");
  denied(request(`${origin}/status`), [500, 502, 503, 504]);
  process.stdout.write("Hosted sign-in fixture passed\n");
} catch (error) {
  process.stderr.write(compose("logs", "--no-color"));
  throw error;
} finally {
  try {
    compose("down", "--volumes", "--remove-orphans");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
