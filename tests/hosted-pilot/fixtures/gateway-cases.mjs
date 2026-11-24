import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  chmodSync,
  chownSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import {
  AUTHORIZATION_SELECTION_CASES,
  assertAdmissionWire,
  assertCsrfCookieHeader,
  assertLogoutClearingCookies,
  assertProxyDelta,
  assertProxyWireMatch,
  assertStrictSniRejection,
  readNativeObservationBarrier,
  readNativeObserverHealth,
  scanResponsesForLeaks,
  selectForwardAuthRootEvents,
  validateExpectedProvenance,
  validateProcessLogs,
  verifyObserverDirectory,
} from "./raw-https.mjs";

// Run only inside the isolated controller after the owned native lifecycle is approved.
assert.equal(
  process.env.GWRK_051_OWNED_CONTROLLER,
  "1",
  "gateway fixture requires an approved isolated controller",
);
assert.equal(
  process.env.DOCKER_HOST,
  "unix:///var/run/docker.sock",
  "controller must use only its nested daemon",
);
const clientA = process.env.GWRK_051_CLIENT_A;
const clientB = process.env.GWRK_051_CLIENT_B;
for (const name of [clientA, clientB])
  assert.match(name ?? "", /^gwrk-051-client-[ab]-[a-f0-9]{24}$/);

const expectedProvenance = validateExpectedProvenance({
  runId: process.env.GWRK_051_RUN_ID,
  proxyImageId: process.env.GWRK_051_PROXY_IMAGE_ID,
  traefikImageId: process.env.GWRK_051_TRAEFIK_IMAGE_ID,
  runtimeReceiptSha256: process.env.GWRK_051_RUNTIME_RECEIPT_SHA256,
});

const processLogsFile = process.env.GWRK_051_PROCESS_LOGS_FILE;
const processContainers = {
  traefik: process.env.GWRK_051_TRAEFIK_CONTAINER,
  proxy: process.env.GWRK_051_PROXY_CONTAINER,
  origin: process.env.GWRK_051_ORIGIN_CONTAINER,
};
if (!processLogsFile) {
  for (const [role, containerName] of Object.entries(processContainers)) {
    assert.match(
      containerName ?? "",
      /^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$/,
      `missing required log-capture container identity for ${role}`,
    );
  }
}

const observerDir = process.env.GWRK_051_OBSERVER_DIR ?? "/fixture/observer";
assert.equal(
  observerDir,
  "/fixture/observer",
  "GWRK_051_OBSERVER_DIR must equal /fixture/observer",
);
verifyObserverDirectory(observerDir, { requireRootOwnership: true });

const origin = "https://gwrk.gforge.ai";
const clientIp = (name) => (name === clientA ? "172.31.51.11" : "172.31.51.12");
const canaries = [
  "051_CALLBACK_CODE_CANARY",
  "051_CALLBACK_STATE_CANARY",
  "051_ERROR_QUERY_CANARY",
  "051_CALLER_BEARER_CANARY",
  "051_UPSTREAM_ERROR_CANARY",
  "051_WRONG_CSRF_CANARY",
];

// Kept strictly in memory for leak scanning; never persisted or logged.
const scannedResponses = [];
const liveSecrets = [];
const seenLiveSecrets = new Set();
function addLiveSecret(label, value) {
  if (typeof value !== "string" || value.length < 8) return;
  const key = `${label}:${value}`;
  if (seenLiveSecrets.has(key)) return;
  seenLiveSecrets.add(key);
  liveSecrets.push({ label, value });
}

const observe = () =>
  JSON.parse(readFileSync("/fixture/service/observations.json", "utf8"));
const issuerObserve = () =>
  JSON.parse(readFileSync("/fixture/service/issuer-observations.json", "utf8"));
const fields = (response, name) =>
  (response.fields ?? [])
    .filter(([key]) => key === name.toLowerCase())
    .map(([, value]) => value);

let barrierSequence = 0;
function barrier() {
  barrierSequence++;
  return readNativeObservationBarrier({
    observerDir,
    observationPath: `${observerDir}/native-observation.json`,
    barrierPath: `${observerDir}/native-observation-barrier.json`,
    healthPath: `${observerDir}/native-observer-health.json`,
    expected: expectedProvenance,
    barrierSequence,
    timeoutMs: 5000,
    pollMs: 25,
  });
}

function client(name, command, allowFailure = false, scanOptions = {}) {
  const execTimeout = Math.min(
    60_000,
    Math.max(10_000, (command.timeoutMs ?? 5000) + 5000),
  );
  let raw;
  try {
    raw = execFileSync(
      "docker",
      ["exec", "--interactive", name, "node", "/fixture/fixtures/client.mjs"],
      {
        input: JSON.stringify(command),
        encoding: "utf8",
        timeout: execTimeout,
        maxBuffer: 131072,
      },
    );
  } catch (error) {
    if (allowFailure && error.stdout) {
      try {
        const parsed = JSON.parse(error.stdout);
        if (parsed.failed) return parsed;
      } catch {}
    }
    throw error;
  }
  const result = JSON.parse(raw);
  if (!allowFailure) {
    assert.equal(result.failed, undefined, "native client request failed");
  }
  if (!command.operation && typeof result.body === "string") {
    scannedResponses.push({
      label:
        scanOptions.label ??
        `${command.method ?? "GET"} ${(command.path ?? "/").split("?")[0]}`,
      body: result.body,
      allowLabels: scanOptions.allowLabels ?? [],
    });
  }
  return result;
}

function safeRoot(response) {
  for (const name of [
    "set-cookie",
    "location",
    "x-forwarded-for",
    "x-forwarded-uri",
    "x-forwarded-method",
  ])
    assert.equal(
      fields(response, name).length,
      0,
      `root leaked forbidden ${name}`,
    );
  assert.equal(
    canaries.some((value) => (response.body ?? "").includes(value)),
    false,
    "root reflected a canary",
  );
}

function assertZeroOperationTables(obs) {
  assert.equal(obs.effects, 0, "unexpected operational effects");
  assert.equal(obs.notify, 0, "unexpected notification calls");
  assert.equal(obs.worker, 0, "unexpected worker launches");
  for (const table of [
    "dispatch_operations",
    "harvest_operations",
    "harvest_deliveries",
    "notification_outbox",
  ]) {
    assert.equal(obs.rows?.[table], 0, `non-zero rows in ${table}`);
  }
}

let controlSequence = 0;
function sendControl(command) {
  controlSequence++;
  const payload = { sequence: controlSequence, ...command };
  const target = "/fixture/service/control.json";
  const next = "/fixture/service/control.next";
  writeFileSync(next, JSON.stringify(payload), { mode: 0o600 });
  try {
    chownSync(next, 10001, 10001);
  } catch {}
  renameSync(next, target);
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const obs = observe();
    if (obs.controlError)
      throw new Error("fixture origin control error observed");
    if (obs.controlSequence >= controlSequence) return;
    execFileSync("sleep", ["0.05"]);
  }
  throw new Error("fixture control acknowledgement timed out");
}

function issuerAuthorize(location, fixtureCase) {
  const url = new URL(location);
  assert.equal(url.origin, "https://127.0.0.1:18443");
  if (fixtureCase) url.searchParams.set("fixture_case", fixtureCase);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { ca: readFileSync("/fixture/public/ca.pem"), rejectUnauthorized: true },
      (res) => {
        res.resume();
        res.once("end", () => {
          if (res.statusCode !== 302)
            reject(new Error("fixture authorization failed"));
          else resolve(res.headers.location);
        });
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("fixture issuer deadline")),
    );
    req.once("error", reject);
    req.end();
  });
}

async function signIn(
  name,
  mutateCallback = (value) => value,
  fixtureCase = "valid",
  verifyProxyWire = false,
) {
  const beforeStartObs = verifyProxyWire ? barrier() : null;
  const start = client(name, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    start.status,
    302,
    "proxy start did not redirect to the verified fixture issuer",
  );
  const afterStartObs = verifyProxyWire ? barrier() : null;
  if (verifyProxyWire) {
    const startDelta = assertProxyDelta(beforeStartObs, afterStartObs, 1);
    assertProxyWireMatch(startDelta, start.requestProof, clientIp(name));
  }
  const callback = await issuerAuthorize(
    fields(start, "location")[0],
    fixtureCase,
  );
  const rawUrl = new URL(callback);
  addLiveSecret("live_callback_code", rawUrl.searchParams.get("code") ?? "");
  addLiveSecret("live_callback_state", rawUrl.searchParams.get("state") ?? "");
  const url = new URL(mutateCallback(callback));
  assert.equal(url.origin, origin);
  const response = client(name, { path: url.pathname + url.search });
  if (verifyProxyWire) {
    const afterCbObs = barrier();
    const cbDelta = assertProxyDelta(afterStartObs, afterCbObs, 1);
    assertProxyWireMatch(cbDelta, response.requestProof, clientIp(name));
  }
  return {
    response,
    callback: url.pathname + url.search,
  };
}

function captureProcessLogs() {
  if (processLogsFile) {
    return JSON.parse(readFileSync(processLogsFile, "utf8"));
  }
  const streams = {};
  for (const [role, containerName] of Object.entries(processContainers)) {
    const proc = spawnSync("docker", ["logs", containerName], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(
      proc.status,
      0,
      `failed to capture stdout/stderr logs for ${role}`,
    );
    streams[role] = {
      stdout: proc.stdout ?? "",
      stderr: proc.stderr ?? "",
    };
  }
  return streams;
}

const SPOOFED_FORWARDING_HEADER_CASES = [
  ["X-Forwarded-For: 203.0.113.9, 198.51.100.2"],
  ["X-Forwarded-For: 203.0.113.9", "X-Forwarded-For: 198.51.100.2"],
  ["X-Forwarded-For: 203.0.113.9", "Connection: X-Forwarded-For"],
  ["X-Forwarded-Uri: /admin", "Connection: X-Forwarded-Uri"],
  ["X_Forwarded_For: 203.0.113.9"],
  ["X.Forwarded.For: 203.0.113.9"],
  ["X_Forwarded_Uri: /admin"],
  ["X.Forwarded.Method: POST"],
];

try {
  // 1. Direct root GET and HEAD
  let before = observe();
  const rootGet = client(clientA, {
    path: "/?code=051_CALLBACK_CODE_CANARY&state=051_CALLBACK_STATE_CANARY",
  });
  assert.equal(rootGet.status, 200);
  safeRoot(rootGet);
  const rootHead = client(clientA, { path: "/", method: "HEAD" });
  assert.equal(rootHead.status, 200);
  assert.equal(rootHead.body, "");
  safeRoot(rootHead);
  let after = observe();
  assert.equal(
    after.loginAllowed - before.loginAllowed,
    2,
    "direct root charged more than one owner check per request",
  );
  assert.equal(
    after.loginAttempts - before.loginAttempts,
    2,
    "direct root triggered recursive ForwardAuth attempts",
  );
  const directRootEvents = after.requests.slice(before.requests.length);
  assert.equal(directRootEvents.length, 2);
  assert.equal(directRootEvents[0].method, "GET");
  assert.equal(directRootEvents[1].method, "HEAD");
  for (const ev of directRootEvents) {
    assert.equal(ev.path, "/");
    assert.equal(ev.peer, "127.0.0.1");
    assert.equal(ev.forwardedFor, "172.31.51.11");
    assert.equal(ev.forwardedForCount, 1);
  }
  const afterDirectRootIndex = after.requests.length;

  // 2. Browser round trip with real ID token + exact dual-wire callback verification
  const initialStart = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    initialStart.status,
    302,
    "proxy start did not redirect to the verified fixture issuer",
  );
  const afterInitialStartObs = barrier();
  assert.equal(
    afterInitialStartObs.proxyRequests.length,
    1,
    "direct root controls triggered unexpected proxy invocations",
  );
  assertProxyWireMatch(
    afterInitialStartObs.proxyRequests,
    initialStart.requestProof,
    clientIp(clientA),
  );
  const initialCallbackUrl = await issuerAuthorize(
    fields(initialStart, "location")[0],
    "valid",
  );
  const parsedInitialCb = new URL(initialCallbackUrl);
  assert.equal(parsedInitialCb.origin, origin);
  const consumedCode = parsedInitialCb.searchParams.get("code");
  assert.ok(consumedCode, "initial login callback omitted authorization code");
  addLiveSecret("live_callback_code", consumedCode);
  addLiveSecret(
    "live_callback_state",
    parsedInitialCb.searchParams.get("state") ?? "",
  );
  const initialCallbackPath = parsedInitialCb.pathname + parsedInitialCb.search;
  const loginResp = client(clientA, { path: initialCallbackPath });
  assert.equal(
    loginResp.status,
    302,
    "valid state, nonce and PKCE login failed",
  );
  const afterInitialCbObs = barrier();
  assertProxyWireMatch(
    assertProxyDelta(afterInitialStartObs, afterInitialCbObs, 1),
    loginResp.requestProof,
    clientIp(clientA),
  );

  const session = client(clientA, { path: "/api/auth/session" }, false, {
    label: "initial-session",
    allowLabels: ["csrfToken"],
  });
  assert.equal(
    session.status,
    200,
    "origin rejected the signed Google-compatible ID token",
  );
  addLiveSecret("csrfToken", JSON.parse(session.body).csrfToken ?? "");
  const initialSnapshot = client(clientA, { operation: "snapshot" });
  for (const [k, v] of Object.entries(initialSnapshot.cookieJar ?? {}))
    addLiveSecret(`cookie_${k}`, v);
  const afterInitialSessionObs = barrier();
  const initialAuthDelta = assertProxyDelta(
    afterInitialCbObs,
    afterInitialSessionObs,
    1,
  );
  assert.equal(initialAuthDelta[0].path, "/oauth2/auth");
  assert.equal(initialAuthDelta[0].forwardedFor, clientIp(clientA));
  assert.equal(initialAuthDelta[0].hasForwardedUri, true);
  assert.equal(initialAuthDelta[0].hasForwardedMethod, true);
  assert.ok(
    observe().googleVerification > 0,
    "origin never performed Google token verification",
  );
  assert.ok(
    observe().jwksFetches > 0,
    "origin never fetched the fixture key through its fixed-URL adapter",
  );
  assert.ok(
    observe().forwardedIssuedIdToken > 0,
    "origin never verified forwarded ID token from issuer",
  );
  assert.equal(
    observe().forwardedAccessToken,
    0,
    "access token was forwarded as ID token",
  );

  // 3. State, nonce, single-use code reuse with fresh valid state, and error-query canaries
  const replay = client(clientA, { path: initialCallbackPath });
  assert.ok(replay.status >= 400, "replayed callback succeeded");

  const beforeReuseIssuer = issuerObserve();
  const reusedCode = await signIn(
    clientB,
    (callback) => {
      const fresh = new URL(callback);
      fresh.searchParams.set("code", consumedCode);
      return fresh.href;
    },
    "valid",
    true,
  );
  assert.ok(
    reusedCode.response.status >= 400,
    "reused authorization code succeeded with fresh valid state",
  );
  const afterReuseIssuer = issuerObserve();
  assert.ok(
    afterReuseIssuer.token > beforeReuseIssuer.token,
    "reused code failed before reaching issuer /token endpoint",
  );
  assert.ok(
    afterReuseIssuer.denied > beforeReuseIssuer.denied,
    "issuer /token did not record single-use code reuse denial",
  );

  const wrongState = await signIn(clientB, (callback) => {
    const value = new URL(callback);
    value.searchParams.set("state", "051_CALLBACK_STATE_CANARY");
    return value.href;
  });
  assert.ok(
    wrongState.response.status >= 400,
    "wrong callback state succeeded",
  );

  const wrongNonce = await signIn(clientB, (v) => v, "wrong-nonce");
  assert.ok(
    wrongNonce.response.status >= 400,
    "wrong nonce callback succeeded",
  );

  const missingNonce = await signIn(clientB, (v) => v, "missing-nonce");
  assert.ok(
    missingNonce.response.status >= 400,
    "missing nonce callback succeeded",
  );

  // Send error-query canary through real error paths
  const errorCallback = client(clientB, {
    path: "/oauth2/callback?error=051_ERROR_QUERY_CANARY&state=051_CALLBACK_STATE_CANARY",
  });
  assert.ok(
    errorCallback.status >= 400,
    "error-query callback unexpectedly succeeded",
  );
  const errorNotFound = client(clientB, {
    path: "/api/nonexistent?error=051_ERROR_QUERY_CANARY&code=051_CALLBACK_CODE_CANARY",
    cookie: false,
  });
  assert.ok(
    [401, 404].includes(errorNotFound.status),
    "unclassified error-query route unexpectedly succeeded",
  );

  client(clientB, { operation: "reset" });
  assert.equal(observe().effects, 0, "denied callbacks caused origin effects");

  // 4. Negative signature & claims controls + live allowlist removal (exact 403) + recovery
  for (const negativeCase of [
    "wrong-signature",
    "wrong-issuer",
    "wrong-audience",
    "expired",
    "unverified",
    "unlisted",
  ]) {
    const negative = await signIn(clientB, (v) => v, negativeCase);
    assert.ok(
      negative.response.status >= 400,
      `${negativeCase} callback succeeded`,
    );
  }

  const tokenError = await signIn(clientB, (v) => v, "token-error");
  assert.ok(
    tokenError.response.status >= 400,
    "token-error callback succeeded",
  );
  assert.equal(
    tokenError.response.body.includes("051_UPSTREAM_ERROR_CANARY"),
    false,
    "upstream error canary reflected in client response",
  );
  client(clientB, { operation: "reset" });

  // Live allowlist removal denies re-verification without restart with exact 403, then recovers
  const allowlistPath = "/etc/gwrk/secrets/google-account-allowlist";
  const originalAllowlist = readFileSync(allowlistPath, "utf8");
  try {
    writeFileSync(allowlistPath, "other@example.invalid\n", { mode: 0o640 });
    try {
      chownSync(allowlistPath, 0, 10001);
      chmodSync(allowlistPath, 0o640);
    } catch {}
    const beforeAllowlist = observe();
    const unlistedSession = client(clientA, { path: "/api/auth/session" });
    assert.equal(
      unlistedSession.status,
      403,
      "allowlist removal did not deny with exact 403",
    );
    assert.ok(
      observe().googleVerification > beforeAllowlist.googleVerification,
      "allowlist removal did not invoke origin Google verifier",
    );
    assert.equal(observe().effects, 0);
  } finally {
    writeFileSync(allowlistPath, originalAllowlist, { mode: 0o640 });
    try {
      chownSync(allowlistPath, 0, 10001);
      chmodSync(allowlistPath, 0o640);
    } catch {}
  }
  const beforeRecovery = observe();
  const recoveredSession = client(
    clientA,
    { path: "/api/auth/session" },
    false,
    { label: "allowlist-recovered", allowLabels: ["csrfToken"] },
  );
  assert.equal(
    recoveredSession.status,
    200,
    "session did not recover after restoring allowlist without restart",
  );
  assert.ok(
    observe().googleVerification > beforeRecovery.googleVerification,
    "allowlist recovery did not re-verify token",
  );
  addLiveSecret("csrfToken", JSON.parse(recoveredSession.body).csrfToken ?? "");

  // 5. Authorization selection, duplicate keys with valid browser cookie, canonical forged/alias headers
  const { apiKey, projectId } = JSON.parse(
    readFileSync("/fixture/service/client-input.json", "utf8"),
  );
  addLiveSecret("apiKey", apiKey);

  for (const row of AUTHORIZATION_SELECTION_CASES) {
    const beforeSelProxy = barrier();
    const response = client(
      clientA,
      {
        path: "/api/auth/session",
        headers: row.lines,
      },
      false,
      {
        label: `auth-selection-${row.label}`,
        allowLabels: row.browserEligible ? ["csrfToken"] : [],
      },
    );
    const afterSelProxy = barrier();
    if (row.browserEligible) {
      assert.equal(
        response.status,
        200,
        "absent caller authorization lost browser eligibility",
      );
      addLiveSecret("csrfToken", JSON.parse(response.body).csrfToken ?? "");
      const delta = assertProxyDelta(beforeSelProxy, afterSelProxy, 1);
      assert.equal(delta[0].path, "/oauth2/auth");
      assert.equal(delta[0].forwardedFor, clientIp(clientA));
      assert.equal(delta[0].hasForwardedUri, true);
      assert.equal(delta[0].hasForwardedMethod, true);
    } else {
      assert.ok(
        [400, 401].includes(response.status),
        `caller authorization presence fell back to browser: ${row.label}`,
      );
      assert.equal(
        fields(response, "location").length,
        0,
        "invalid API input redirected to browser login",
      );
      assertProxyDelta(beforeSelProxy, afterSelProxy, 0);
    }
  }

  // Caller bearer canary on both unauthenticated API and browser-cookie conflict paths
  for (const [targetClient, withCookie] of [
    [clientB, false],
    [clientA, true],
  ]) {
    const beforeCanaryProxy = barrier();
    const bearerCanaryResp = client(targetClient, {
      path: `/api/status?projectId=${encodeURIComponent(projectId)}&error=051_ERROR_QUERY_CANARY`,
      cookie: withCookie,
      headers: ["Authorization: Bearer 051_CALLER_BEARER_CANARY"],
    });
    assert.equal(
      bearerCanaryResp.status,
      401,
      "caller bearer canary was not denied with 401",
    );
    assert.equal(fields(bearerCanaryResp, "location").length, 0);
    assertProxyDelta(beforeCanaryProxy, barrier(), 0);
  }

  // Canonical forbidden public identity headers & X-Gwrk-Auth-Mode values
  for (const forged of [
    ["X-Forwarded-User: allowed@example.invalid"],
    ["X-Forwarded-Email: allowed@example.invalid"],
    ["X-Forwarded-Groups: admin"],
    ["X-Forwarded-Preferred-Username: allowed"],
    ["X-Forwarded-Access-Token: fake-access-token"],
    ["X-Auth-Request-User: https://accounts.google.com:051-synthetic-subject"],
    ["X-Auth-Request-Email: allowed@example.invalid"],
    ["X-Gwrk-Auth-Mode: google_id_token"],
    [
      "X-Gwrk-Auth-Mode: google_id_token",
      "Authorization: Bearer fake.jwt.token",
    ],
    ["X-Gwrk-Auth-Mode: api_key"],
    ["X-Gwrk-Auth-Mode: webhook"],
  ]) {
    const forgedResp = client(clientB, {
      path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
      cookie: false,
      headers: forged,
    });
    assert.ok(
      [400, 401].includes(forgedResp.status),
      `forged canonical header bypassed verification: ${forged.join(", ")}`,
    );
    assert.equal(fields(forgedResp, "location").length, 0);
  }

  // Valid API key control
  before = observe();
  let beforeApiProxy = barrier();
  const api = client(clientB, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(api.status, 200, "valid fixture API key control failed");
  assertProxyDelta(beforeApiProxy, barrier(), 0);

  // Duplicate valid/invalid API keys WITH valid browser cookie (clientA) and without (clientB)
  for (const headers of [
    [
      `Authorization: Bearer ${apiKey}`,
      "Authorization: Bearer invalid-fixture",
    ],
    [
      "Authorization: Bearer invalid-fixture",
      `Authorization: Bearer ${apiKey}`,
    ],
  ]) {
    for (const [targetClient, withCookie] of [
      [clientA, true],
      [clientB, false],
    ]) {
      beforeApiProxy = barrier();
      const duplicate = client(targetClient, {
        path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
        cookie: withCookie,
        headers,
      });
      assert.equal(
        duplicate.status,
        401,
        "duplicate caller authorization was not denied with 401",
      );
      assert.equal(fields(duplicate, "location").length, 0);
      assertProxyDelta(beforeApiProxy, barrier(), 0);
    }
  }

  // API key + valid browser cookie conflict
  beforeApiProxy = barrier();
  const conflict = client(clientA, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(
    conflict.status,
    401,
    "API chain dropped session cookies and bypassed conflict denial",
  );
  assert.equal(fields(conflict, "location").length, 0);
  assertProxyDelta(beforeApiProxy, barrier(), 0);
  after = observe();
  assert.equal(
    after.loginAttempts,
    before.loginAttempts,
    "API requests entered the proxy-login admission chain",
  );

  // Dot, underscore, comma-list, duplicate & Connection-nominated forwarding headers on API and login routes
  for (const spoofHeaders of SPOOFED_FORWARDING_HEADER_CASES) {
    const beforeSpoofApi = observe();
    const beforeSpoofApiProxy = barrier();
    const apiSpoof = client(clientB, {
      path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
      cookie: false,
      headers: [`Authorization: Bearer ${apiKey}`, ...spoofHeaders],
    });
    assertProxyDelta(beforeSpoofApiProxy, barrier(), 0);
    if (apiSpoof.status === 200) {
      const added = observe().requests.slice(beforeSpoofApi.requests.length);
      assert.equal(added.length, 1);
      assert.equal(added[0].peer, "127.0.0.1");
      assert.equal(added[0].forwardedFor, clientIp(clientB));
      assert.equal(added[0].forwardedForCount, 1);
    } else {
      assert.ok(
        [400, 401, 503].includes(apiSpoof.status),
        `unexpected API spoof status ${apiSpoof.status}`,
      );
    }

    const beforeSpoofLogin = observe();
    const beforeSpoofLoginProxy = barrier();
    const loginSpoof = client(clientB, {
      path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
      headers: spoofHeaders,
    });
    const afterSpoofLoginProxy = barrier();
    if (loginSpoof.status === 302) {
      const rootAdded = observe()
        .requests.slice(beforeSpoofLogin.requests.length)
        .filter((ev) => ev.path === "/");
      assertAdmissionWire(rootAdded);
      for (const ev of rootAdded)
        assert.equal(ev.forwardedFor, clientIp(clientB));
      const proxyDelta = assertProxyDelta(
        beforeSpoofLoginProxy,
        afterSpoofLoginProxy,
        1,
      );
      assert.equal(proxyDelta[0].forwardedFor, clientIp(clientB));
      assert.equal(proxyDelta[0].forwardedForCount, 1);
      assert.equal(proxyDelta[0].hasForwardedUri, false);
      assert.equal(proxyDelta[0].hasForwardedMethod, false);
    } else {
      assert.ok(
        [400, 503].includes(loginSpoof.status),
        `unexpected login spoof status ${loginSpoof.status}`,
      );
      safeRoot(loginSpoof);
      assertProxyDelta(beforeSpoofLoginProxy, afterSpoofLoginProxy, 0);
    }
  }
  client(clientB, { operation: "reset" });
  assert.equal(observe().effects, 0, "fixture caused an operational effect");

  // 6. Unfiltered ForwardAuth root admission wire verification (direct root controls excluded)
  const admissionRootEvents = selectForwardAuthRootEvents(
    observe().requests,
    afterDirectRootIndex,
  );
  assertAdmissionWire(admissionRootEvents);

  // 7. Quota exhaustion across direct root, /oauth2/start, /oauth2/callback + spoofed-XFF immunity + Client B independence
  let quotaHit = false;
  for (let i = 0; i < 65; i++) {
    const res = client(
      clientA,
      i % 2 === 0
        ? { path: "/", method: "HEAD" }
        : { path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession" },
    );
    if (res.status === 429) {
      quotaHit = true;
      safeRoot(res);
      break;
    }
  }
  assert.ok(quotaHit, "Client A quota was not exhausted after 60 checks");

  for (const deniedLoginPath of [
    "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
    "/oauth2/callback?code=051_CALLBACK_CODE_CANARY&state=051_CALLBACK_STATE_CANARY",
    "/",
  ]) {
    const beforeQuota = observe();
    const beforeQuotaProxy = barrier();
    const denied = client(clientA, { path: deniedLoginPath });
    assert.equal(
      denied.status,
      429,
      `exhausted quota did not return 429 on ${deniedLoginPath}`,
    );
    safeRoot(denied);
    const afterQuota = observe();
    assert.equal(
      afterQuota.loginAllowed,
      beforeQuota.loginAllowed,
      "429 denial grew loginAllowed counter",
    );
    assert.ok(afterQuota.loginAttempts > beforeQuota.loginAttempts);
    assertProxyDelta(beforeQuotaProxy, barrier(), 0);
  }

  // Spoofed forwarding headers cannot bypass exhausted Client A quota
  for (const spoofHeaders of SPOOFED_FORWARDING_HEADER_CASES) {
    const beforeQuota = observe();
    const beforeQuotaProxy = barrier();
    const spoofed = client(clientA, {
      path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
      headers: spoofHeaders,
    });
    assert.ok(
      [400, 429].includes(spoofed.status),
      "spoofed forwarding header bypassed exhausted quota",
    );
    safeRoot(spoofed);
    assert.equal(observe().loginAllowed, beforeQuota.loginAllowed);
    assertProxyDelta(beforeQuotaProxy, barrier(), 0);
  }

  // Client B remains unaffected
  const beforeClientBProxy = barrier();
  const clientBStart = client(clientB, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    clientBStart.status,
    302,
    "Client B login was affected by Client A quota exhaustion",
  );
  assertProxyDelta(beforeClientBProxy, barrier(), 1);
  const clientBCheck = client(clientB, { path: "/", method: "HEAD" });
  assert.equal(
    clientBCheck.status,
    200,
    "Client B direct root was affected by Client A quota exhaustion",
  );
  safeRoot(clientBCheck);
  client(clientB, { operation: "reset" });

  // Advance rate clock to sweep buckets
  sendControl({ advanceRateMs: 120001 });

  // 8. Shared capacity limit at 1000 buckets: 997 prefill + 1 login + 2 API buckets = 1000, zero crypto on 1001st, no eviction
  sendControl({ prefillLoginBuckets: 997 });
  assert.equal(observe().prefillAccepted, 997);

  // Bucket 998: login:172.31.51.11
  const capLogin998 = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(capLogin998.status, 302, "bucket 998 login failed");

  // Buckets 999 & 1000: unverified:172.31.51.12 + verified:api_key:fixture-operator
  const capApi1000 = client(clientB, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(capApi1000.status, 200, "buckets 999-1000 verified API failed");

  // 1001st distinct key (API unverified:172.31.51.11): 429 before cryptographic work
  const beforeCap = observe();
  const beforeCapProxy = barrier();
  const capacityApiDenial = client(clientA, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(
    capacityApiDenial.status,
    429,
    "1001st API bucket was not denied with 429",
  );
  const afterCapApi = observe();
  assert.equal(
    afterCapApi.apiCrypto,
    beforeCap.apiCrypto,
    "capacity denial performed API crypto work",
  );
  assert.equal(
    afterCapApi.googleVerification,
    beforeCap.googleVerification,
    "capacity denial performed Google verification",
  );
  assert.equal(afterCapApi.apiVerified, beforeCap.apiVerified);
  assertProxyDelta(beforeCapProxy, barrier(), 0);

  // 1001st distinct key (login:172.31.51.12): 429 before proxy work
  const beforeCapLogin = observe();
  const beforeCapLoginProxy = barrier();
  const capacityLoginDenial = client(clientB, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    capacityLoginDenial.status,
    429,
    "1001st login bucket was not denied with 429",
  );
  safeRoot(capacityLoginDenial);
  assert.equal(observe().loginAllowed, beforeCapLogin.loginAllowed);
  assertProxyDelta(beforeCapLoginProxy, barrier(), 0);

  // Existing active buckets remain active and un-evicted
  const existingLoginOk = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    existingLoginOk.status,
    302,
    "existing active login bucket was evicted",
  );
  const beforeExistingApi = observe();
  const existingApiOk = client(clientB, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(
    existingApiOk.status,
    200,
    "existing active API buckets were evicted",
  );
  assert.ok(
    observe().apiCrypto > beforeExistingApi.apiCrypto,
    "existing API request did not execute crypto verifier",
  );
  // Still saturated for new key
  const stillCapBefore = observe();
  const stillCapDenial = client(clientA, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(stillCapDenial.status, 429);
  assert.equal(observe().apiCrypto, stillCapBefore.apiCrypto);

  sendControl({ advanceRateMs: 120001 });
  const reclaimedLogin = client(clientB, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    reclaimedLogin.status,
    302,
    "capacity was not reclaimed after 120s idle retention",
  );
  client(clientB, { operation: "reset" });
  sendControl({ advanceRateMs: 120001 });

  // 9. ForwardAuth failure modes & deterministic active in-flight cancellation (all routed via /oauth2/start)
  sendControl({ loginFault: "dependency" });
  let beforeFault = observe();
  let beforeFaultProxy = barrier();
  const depFailure = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(depFailure.status, 503, "dependency failure did not return 503");
  safeRoot(depFailure);
  assert.equal(observe().loginAllowed, beforeFault.loginAllowed);
  assertProxyDelta(beforeFaultProxy, barrier(), 0);

  sendControl({ loginFault: "connection" });
  beforeFault = observe();
  beforeFaultProxy = barrier();
  const connFailure = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    connFailure.status,
    500,
    "ForwardAuth connection failure did not return built-in 500",
  );
  safeRoot(connFailure);
  assert.equal(observe().loginAllowed, beforeFault.loginAllowed);
  assertProxyDelta(beforeFaultProxy, barrier(), 0);

  sendControl({ loginFault: "oversized" });
  beforeFaultProxy = barrier();
  const overFailure = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    overFailure.status,
    401,
    "oversized admission body did not return built-in 401",
  );
  safeRoot(overFailure);
  assertProxyDelta(beforeFaultProxy, barrier(), 0);

  sendControl({ loginFault: "timeout" });
  beforeFaultProxy = barrier();
  const timeoutStartMs = Date.now();
  const timeoutFailure = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
    timeoutMs: 38_000,
  });
  const timeoutElapsedMs = Date.now() - timeoutStartMs;
  assert.equal(
    timeoutFailure.status,
    500,
    "ForwardAuth 30-second timeout did not return built-in 500",
  );
  assert.ok(
    timeoutElapsedMs >= 25_000,
    `ForwardAuth timeout returned too early (${timeoutElapsedMs}ms)`,
  );
  safeRoot(timeoutFailure);
  assertProxyDelta(beforeFaultProxy, barrier(), 0);

  // Deterministic in-flight cancellation while origin holds ForwardAuth response open
  const beforeCancel = observe();
  const beforeCancelProxy = barrier();
  const cancelledReq = client(clientA, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
    cancelAfterMs: 250,
  });
  assert.equal(
    cancelledReq.cancelled,
    true,
    "cancelled request did not record cancelled state",
  );
  const cancelDeadline = Date.now() + 2000;
  while (
    Date.now() < cancelDeadline &&
    observe().cancelledInFlightResponses <=
      beforeCancel.cancelledInFlightResponses
  ) {
    execFileSync("sleep", ["0.05"]);
  }
  const afterCancel = observe();
  assert.ok(
    afterCancel.loginAttempts > beforeCancel.loginAttempts,
    "cancelled request never reached ForwardAuth origin check",
  );
  assert.ok(
    afterCancel.cancelledInFlightResponses >
      beforeCancel.cancelledInFlightResponses,
    "origin did not observe in-flight cancellation",
  );
  assertProxyDelta(beforeCancelProxy, barrier(), 0);

  sendControl({ loginFault: "none" });
  sendControl({ advanceRateMs: 120001 });

  // 10. Lost committed responses, warmed transport, 60-check conservative cap, and cancelled unused-dial scenario
  function runLostResponseGenerationScenario(prepareTransport, options = {}) {
    const genStart = observe();
    const genStartProxy = barrier();
    prepareTransport();
    sendControl({ dropNextCommitted: true });
    const beforeDrop = observe();
    const beforeDropProxy = barrier();
    const droppedAttempt = client(clientA, {
      path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
    });
    const afterDrop = observe();
    const afterDropProxy = barrier();
    const dropSockets =
      afterDrop.droppedCommittedResponses -
      beforeDrop.droppedCommittedResponses;
    const dropAttempts = afterDrop.loginAttempts - beforeDrop.loginAttempts;
    const dropAllowed = afterDrop.loginAllowed - beforeDrop.loginAllowed;
    const dropProxy =
      afterDropProxy.proxyRequests.length -
      beforeDropProxy.proxyRequests.length;
    assert.equal(
      dropSockets,
      1,
      "drop-next-committed did not destroy committed response socket",
    );
    assert.ok(dropAttempts >= 1 && dropAllowed >= 1);
    if (droppedAttempt.status === 302) {
      assert.ok(
        dropAttempts >= 2 && dropAllowed >= 2,
        "retried ForwardAuth lost-response did not retain retry charge",
      );
      assert.equal(
        dropProxy,
        1,
        "retried 302 login did not produce one proxy invocation",
      );
    } else {
      assert.equal(
        droppedAttempt.status,
        500,
        "non-retried lost-response did not return built-in 500",
      );
      safeRoot(droppedAttempt);
      assert.equal(dropAllowed, 1);
      assert.equal(
        dropProxy,
        0,
        "failed lost-response still invoked downstream proxy",
      );
    }
    sendControl({ dropNextCommitted: false });

    if (options.afterDrop) {
      options.afterDrop();
    }

    let exhausted = false;
    for (let i = 0; i < 65; i++) {
      const res = client(clientA, {
        path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
      });
      if (res.status === 429) {
        exhausted = true;
        safeRoot(res);
        break;
      }
      assert.equal(res.status, 302);
    }
    assert.ok(exhausted, "generation did not exhaust at 60 successful checks");
    const genEnd = observe();
    const genEndProxy = barrier();
    const totalAllowed = genEnd.loginAllowed - genStart.loginAllowed;
    const totalAttempts = genEnd.loginAttempts - genStart.loginAttempts;
    const totalProxy =
      genEndProxy.proxyRequests.length - genStartProxy.proxyRequests.length;
    assert.equal(
      totalAllowed,
      60,
      `generation permitted ${totalAllowed} successful checks instead of 60`,
    );
    assert.ok(
      totalProxy <= 60 - dropSockets,
      `lost response expanded proxy allowance (${totalProxy} > ${60 - dropSockets})`,
    );
    assert.ok(totalAttempts > totalAllowed);
  }

  // Scenario A: Warmed ForwardAuth transport loses committed response
  runLostResponseGenerationScenario(() => {
    const beforeWarmProxy = barrier();
    const warm = client(clientA, {
      path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
    });
    assert.equal(warm.status, 302, "ForwardAuth warmup request failed");
    assertProxyDelta(beforeWarmProxy, barrier(), 1);
  });

  sendControl({ advanceRateMs: 120001 });

  // Scenario B: Cancelled unused-dial followed by lost committed response
  runLostResponseGenerationScenario(
    () => {
      sendControl({ loginFault: "timeout" });
      const beforeUnusedProxy = barrier();
      for (let i = 0; i < 2; i++) {
        const cancelledDial = client(clientA, {
          path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
          cancelAfterMs: 80,
        });
        assert.equal(cancelledDial.cancelled, true);
      }
      assertProxyDelta(beforeUnusedProxy, barrier(), 0);
      sendControl({ loginFault: "none" });
    },
    {
      afterDrop: () => {
        const health = readNativeObserverHealth({
          observerDir,
          expected: expectedProvenance,
        });
        assert.ok(
          health.originTcpSummary.zeroPriorRequestReusedConnections >= 1,
          "Scenario B requires real zero-request parked/reused connection proof (zeroPriorRequestReusedConnections >= 1)",
        );
        assert.equal(
          health.originTcpSummary.unusedDialObserved,
          true,
          "Scenario B requires unusedDialObserved === true",
        );
      },
    },
  );

  sendControl({ advanceRateMs: 120001 });

  // 11. Webhook routing, enrolled repo, HMAC verification, valid browser+API cannot bypass HMAC, zero operation tables
  const preWebhookSession = client(
    clientA,
    { path: "/api/auth/session" },
    false,
    { label: "pre-webhook-session", allowLabels: ["csrfToken"] },
  );
  assert.equal(
    preWebhookSession.status,
    200,
    "clientA browser session was not active before webhook denial checks",
  );
  addLiveSecret(
    "csrfToken",
    JSON.parse(preWebhookSession.body).csrfToken ?? "",
  );

  const webhookSecret = readFileSync(
    "/fixture/service/webhook-secret",
    "utf8",
  ).trim();
  addLiveSecret("webhookSecret", webhookSecret);
  const validPayload = JSON.stringify({
    zen: "fixture",
    repository: { full_name: "fixture/repo" },
  });
  const validSig = `sha256=${createHmac("sha256", webhookSecret).update(validPayload).digest("hex")}`;

  const beforeValidWebhook = observe();
  const beforeValidWebhookProxy = barrier();
  const validWebhook = client(clientB, {
    method: "POST",
    path: "/webhook/github",
    headers: [
      "Content-Type: application/json",
      "X-GitHub-Event: ping",
      "X-GitHub-Delivery: 051-webhook-valid-1",
      `X-Hub-Signature-256: ${validSig}`,
    ],
    body: validPayload,
    cookie: false,
  });
  assert.ok(
    [200, 202].includes(validWebhook.status),
    "valid enrolled-repo webhook HMAC rejected",
  );
  assert.notEqual(
    JSON.parse(validWebhook.body).reason,
    "unenrolled_repository",
    "valid webhook failed enrolled repository lookup",
  );
  const afterValidWebhook = observe();
  assert.equal(
    afterValidWebhook.webhookVerify,
    beforeValidWebhook.webhookVerify + 1,
    "valid webhook did not invoke HMAC verifier",
  );
  assert.equal(
    afterValidWebhook.loginAttempts,
    beforeValidWebhook.loginAttempts,
    "valid webhook triggered login subrequest",
  );
  assertProxyDelta(beforeValidWebhookProxy, barrier(), 0);
  assertZeroOperationTables(afterValidWebhook);

  // Bad HMAC with active browser cookie (clientA) AND valid API key
  const beforeBadWebhook = observe();
  const beforeBadWebhookProxy = barrier();
  const badWebhook = client(clientA, {
    method: "POST",
    path: "/webhook/github",
    headers: [
      "Content-Type: application/json",
      "X-GitHub-Event: ping",
      "X-GitHub-Delivery: 051-webhook-bad-1",
      "X-Hub-Signature-256: sha256=bad0000000000000000000000000000000000000000000000000000000000000",
      `Authorization: Bearer ${apiKey}`,
    ],
    body: validPayload,
  });
  assert.equal(
    badWebhook.status,
    401,
    "bad webhook HMAC did not return exact 401",
  );
  const afterBadWebhook = observe();
  assert.equal(
    afterBadWebhook.webhookVerify,
    beforeBadWebhook.webhookVerify + 1,
    "bad webhook did not reach HMAC verification",
  );
  assert.equal(
    afterBadWebhook.loginAttempts,
    beforeBadWebhook.loginAttempts,
    "bad webhook triggered login subrequest",
  );
  assertProxyDelta(beforeBadWebhookProxy, barrier(), 0);
  assertZeroOperationTables(afterBadWebhook);

  // Missing HMAC with active browser cookie (clientA) AND valid API key
  const beforeMissingWebhook = observe();
  const beforeMissingWebhookProxy = barrier();
  const missingWebhook = client(clientA, {
    method: "POST",
    path: "/webhook/github",
    headers: [
      "Content-Type: application/json",
      "X-GitHub-Event: ping",
      "X-GitHub-Delivery: 051-webhook-missing-1",
      `Authorization: Bearer ${apiKey}`,
    ],
    body: validPayload,
  });
  assert.equal(
    missingWebhook.status,
    401,
    "missing webhook HMAC did not return exact 401",
  );
  const afterMissingWebhook = observe();
  assert.equal(
    afterMissingWebhook.loginAttempts,
    beforeMissingWebhook.loginAttempts,
    "missing webhook triggered login subrequest",
  );
  assertProxyDelta(beforeMissingWebhookProxy, barrier(), 0);
  assertZeroOperationTables(afterMissingWebhook);

  // 12. Browser mutations, HEAD/GET session, CSRF zero-effect controls, public sign_out denial, happy logout + replay, logoutFault 503
  client(clientA, { operation: "reset" });
  const freshLogin = await signIn(clientA, (v) => v, "valid", true);
  assert.equal(freshLogin.response.status, 302);

  const headSession = client(clientA, {
    path: "/api/auth/session",
    method: "HEAD",
  });
  assert.equal(headSession.status, 200);
  assert.equal(
    headSession.body,
    "",
    "HEAD /api/auth/session returned a non-empty body",
  );
  assert.equal(
    fields(headSession, "set-cookie").length,
    0,
    "HEAD /api/auth/session issued a cookie",
  );
  assert.ok(
    fields(headSession, "cache-control").some((v) =>
      v.toLowerCase().includes("no-store"),
    ),
    "HEAD /api/auth/session omitted Cache-Control: no-store",
  );

  const getSession = client(clientA, { path: "/api/auth/session" }, false, {
    label: "csrf-session",
    allowLabels: ["csrfToken"],
  });
  assert.equal(getSession.status, 200);
  assert.ok(
    fields(getSession, "cache-control").some((v) =>
      v.toLowerCase().includes("no-store"),
    ),
    "GET /api/auth/session omitted Cache-Control: no-store",
  );
  const sessionData = JSON.parse(getSession.body);
  assert.equal(sessionData.ok, true);
  assert.ok(sessionData.csrfToken, "GET /api/auth/session omitted csrfToken");
  assert.ok(sessionData.expiresAt, "GET /api/auth/session omitted expiresAt");
  const csrfToken = sessionData.csrfToken;
  addLiveSecret("csrfToken", csrfToken);
  assertCsrfCookieHeader(
    fields(getSession, "set-cookie"),
    Date.parse(sessionData.expiresAt),
  );

  // All denied CSRF / Origin browser mutation controls must return 403 with zero revoke/proxy logout effects
  for (const deniedCase of [
    {
      label: "cross-origin",
      path: "/api/auth/logout",
      headers: [
        "Origin: https://evil.example.invalid",
        `x-gwrk-csrf-token: ${csrfToken}`,
      ],
    },
    {
      label: "missing-origin",
      path: "/api/auth/logout",
      headers: [`x-gwrk-csrf-token: ${csrfToken}`],
    },
    {
      label: "missing-csrf",
      path: "/api/auth/logout",
      headers: [`Origin: ${origin}`],
    },
    {
      label: "wrong-csrf",
      path: "/api/auth/logout",
      headers: [
        `Origin: ${origin}`,
        "x-gwrk-csrf-token: 051_WRONG_CSRF_CANARY",
      ],
    },
    {
      label: "query-csrf-only",
      path: `/api/auth/logout?csrf_token=${encodeURIComponent(csrfToken)}`,
      headers: [`Origin: ${origin}`],
    },
    {
      label: "query-csrf-with-header",
      path: `/api/auth/logout?x-gwrk-csrf-token=${encodeURIComponent(csrfToken)}`,
      headers: [`Origin: ${origin}`, `x-gwrk-csrf-token: ${csrfToken}`],
    },
  ]) {
    const beforeCsrf = observe();
    const beforeCsrfProxy = barrier();
    const res = client(clientA, {
      method: "POST",
      path: deniedCase.path,
      headers: deniedCase.headers,
    });
    assert.equal(
      res.status,
      403,
      `denied CSRF case ${deniedCase.label} did not return 403`,
    );
    const afterCsrf = observe();
    assert.equal(
      afterCsrf.proxyLogout,
      beforeCsrf.proxyLogout,
      `denied CSRF case ${deniedCase.label} invoked proxyLogout`,
    );
    assert.equal(
      afterCsrf.originRevokedBeforeProxy,
      beforeCsrf.originRevokedBeforeProxy,
      `denied CSRF case ${deniedCase.label} revoked origin session`,
    );
    assert.equal(afterCsrf.effects, 0);
    assertProxyDelta(
      beforeCsrfProxy,
      barrier(),
      0,
      (ev) => ev.path !== "/oauth2/auth",
    );
  }

  // Public /oauth2/sign_out is denied and leaves session intact
  const beforePublicSignOut = observe();
  const beforePublicSignOutProxy = barrier();
  const publicSignOut = client(clientA, { path: "/oauth2/sign_out" });
  assert.ok(
    [403, 404].includes(publicSignOut.status),
    "public /oauth2/sign_out was not denied",
  );
  assert.equal(observe().proxyLogout, beforePublicSignOut.proxyLogout);
  assert.equal(
    observe().originRevokedBeforeProxy,
    beforePublicSignOut.originRevokedBeforeProxy,
  );
  assertProxyDelta(
    beforePublicSignOutProxy,
    barrier(),
    0,
    (ev) => ev.path === "/oauth2/sign_out",
  );

  // Snapshot active cookies before happy-path logout
  const savedSnapshot = client(clientA, { operation: "snapshot" });
  const savedJar = savedSnapshot.cookieJar ?? {};
  const sessionCookieNames = Object.keys(savedJar).filter(
    (name) =>
      name === "__Host-gwrk_session" || name.startsWith("__Host-gwrk_session_"),
  );
  assert.ok(
    sessionCookieNames.length > 0,
    "snapshot omitted __Host-gwrk_session cookie(s)",
  );
  assert.ok(
    Boolean(savedJar["__Host-gwrk_csrf"]),
    "snapshot omitted __Host-gwrk_csrf cookie",
  );
  for (const [k, v] of Object.entries(savedJar))
    addLiveSecret(`cookie_${k}`, v);

  // Happy-path POST /api/auth/logout
  const beforeHappyLogout = observe();
  const beforeHappyLogoutProxy = barrier();
  const happyLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [`Origin: ${origin}`, `x-gwrk-csrf-token: ${csrfToken}`],
  });
  assert.equal(happyLogout.status, 200, "happy-path logout failed");
  const happyBody = JSON.parse(happyLogout.body);
  assert.equal(happyBody.ok, true);
  assert.equal(happyBody.proxyCleared, true);
  assert.equal(
    fields(happyLogout, "location").length,
    0,
    "logout leaked Location header",
  );
  assertLogoutClearingCookies(
    fields(happyLogout, "set-cookie"),
    sessionCookieNames,
  );
  const afterHappyLogout = observe();
  assert.equal(afterHappyLogout.proxyLogout, beforeHappyLogout.proxyLogout + 1);
  assert.equal(
    afterHappyLogout.originRevokedBeforeProxy,
    beforeHappyLogout.originRevokedBeforeProxy + 1,
  );
  assertProxyDelta(
    beforeHappyLogoutProxy,
    barrier(),
    1,
    (ev) => ev.path === "/oauth2/sign_out",
  );

  // Post-logout session fails, and copied-cookie replay via restoreCookies fails at origin
  const clearedSession = client(clientA, { path: "/api/auth/session" });
  assert.equal(clearedSession.status, 401);
  const replayedSession = client(clientA, {
    path: "/api/auth/session",
    restoreCookies: savedJar,
  });
  assert.equal(
    replayedSession.status,
    401,
    "replayed snapshotted cookie was accepted after happy logout",
  );
  client(clientA, { operation: "reset" });

  // Proxy logout failure (logoutFault: true -> 503 while origin revocation commits before proxy call)
  const faultyLogin = await signIn(clientA);
  assert.equal(faultyLogin.response.status, 302);
  const faultyGetSession = client(
    clientA,
    { path: "/api/auth/session" },
    false,
    { label: "faulty-logout-session", allowLabels: ["csrfToken"] },
  );
  assert.equal(faultyGetSession.status, 200);
  const faultyCsrf = JSON.parse(faultyGetSession.body).csrfToken;
  addLiveSecret("csrfToken", faultyCsrf);
  const faultySnapshot = client(clientA, { operation: "snapshot" }).cookieJar;
  for (const [k, v] of Object.entries(faultySnapshot ?? {}))
    addLiveSecret(`cookie_${k}`, v);

  sendControl({ logoutFault: true });
  const beforeFaultyLogout = observe();
  const faultyLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [`Origin: ${origin}`, `x-gwrk-csrf-token: ${faultyCsrf}`],
  });
  assert.equal(
    faultyLogout.status,
    503,
    "logout proxy failure did not return 503",
  );
  const faultyBody = JSON.parse(faultyLogout.body);
  assert.equal(faultyBody.ok, true);
  assert.equal(faultyBody.proxyCleared, false);
  assert.ok(
    fields(faultyLogout, "set-cookie").some((val) =>
      val.startsWith("__Host-gwrk_csrf=;"),
    ),
    "503 logout omitted __Host-gwrk_csrf clearing cookie",
  );
  assert.equal(
    observe().originRevokedBeforeProxy,
    beforeFaultyLogout.originRevokedBeforeProxy + 1,
    "origin revocation did not commit before proxy logout",
  );
  assert.equal(observe().proxyLogout, beforeFaultyLogout.proxyLogout + 1);
  sendControl({ logoutFault: false });

  const revokedReplay = client(clientA, {
    path: "/api/auth/session",
    restoreCookies: faultySnapshot,
  });
  assert.equal(
    revokedReplay.status,
    401,
    "revoked session was accepted on replay after 503 proxy logout failure",
  );

  // 13. TLS strict SNI discrimination (server TLS alert, zero cert) & closed port 80 probe
  const unknownSni = client(
    clientA,
    { path: "/", servername: "unknown.example.invalid" },
    true,
  );
  assertStrictSniRejection(unknownSni);

  const nullSni = client(clientA, { path: "/", servername: null }, true);
  assertStrictSniRejection(nullSni);

  const port80 = client(clientA, { operation: "probePort80" });
  assert.equal(port80.closed, true, "port 80 listener is unexpectedly open");
  assert.equal(port80.errorCode, "ECONNREFUSED");

  // 14. Full HTTP response & three-process stdout/stderr leak scan (canaries + private live secrets)
  const responseScan = scanResponsesForLeaks(scannedResponses, {
    canaries,
    liveSecrets,
  });
  const processLogStreams = captureProcessLogs();
  const processLogScan = validateProcessLogs(processLogStreams, {
    canaries,
    liveSecrets,
  });

  // 15. Final fail-closed native observation barrier verification
  const finalObservation = barrier();
  assertZeroOperationTables(observe());

  process.stdout.write(
    `${JSON.stringify({
      event: "gateway_partial_native_assertions_passed",
      acceptanceComplete: false,
      scannedResponses: responseScan.scannedResponses,
      observedProxyRequests: finalObservation.proxyRequests.length,
      processLogLines: Object.fromEntries(
        Object.entries(processLogScan.processes).map(([k, v]) => [
          k,
          v.nonEmptyLines,
        ]),
      ),
      leakCount: 0,
    })}\n`,
  );
} catch (error) {
  // Raw IPC includes synthetic credentials and callbacks. Never dump it or raw secrets.
  if (error?.leakSummary) {
    process.stderr.write(
      `${JSON.stringify({ event: "gateway_leak_detected", ...error.leakSummary })}\n`,
    );
  }
  process.stderr.write(
    "Gateway native fixture assertion failed. Inspect safe counters and sanitized logs.\n",
  );
  process.exitCode = 1;
}
