import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  chownSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import {
  AUTHORIZATION_SELECTION_CASES,
  assertAdmissionWire,
  validateNativeObservation,
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
const origin = "https://gwrk.gforge.ai";
const canaries = [
  "051_CALLBACK_CODE_CANARY",
  "051_CALLBACK_STATE_CANARY",
  "051_ERROR_QUERY_CANARY",
  "051_CALLER_BEARER_CANARY",
  "051_UPSTREAM_ERROR_CANARY",
];
const observe = () =>
  JSON.parse(readFileSync("/fixture/service/observations.json", "utf8"));
const fields = (response, name) =>
  response.fields
    .filter(([key]) => key === name.toLowerCase())
    .map(([, value]) => value);

function client(name, command, allowFailure = false) {
  let raw;
  try {
    raw = execFileSync(
      "docker",
      ["exec", "--interactive", name, "node", "/fixture/fixtures/client.mjs"],
      {
        input: JSON.stringify(command),
        encoding: "utf8",
        timeout: 10_000,
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
    canaries.some((value) => response.body.includes(value)),
    false,
    "root reflected a canary",
  );
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
) {
  const start = client(name, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    start.status,
    302,
    "proxy start did not redirect to the verified fixture issuer",
  );
  const callback = await issuerAuthorize(
    fields(start, "location")[0],
    fixtureCase,
  );
  const url = new URL(mutateCallback(callback));
  assert.equal(url.origin, origin);
  return {
    response: client(name, { path: url.pathname + url.search }),
    callback: url.pathname + url.search,
  };
}

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

  // 2. Browser round trip with real ID token
  const login = await signIn(clientA);
  assert.equal(
    login.response.status,
    302,
    "valid state, nonce and PKCE login failed",
  );
  const session = client(clientA, { path: "/api/auth/session" });
  assert.equal(
    session.status,
    200,
    "origin rejected the signed Google-compatible ID token",
  );
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

  // 3. State, nonce, and replay cases
  const replay = client(clientA, { path: login.callback });
  assert.ok(replay.status >= 400, "replayed callback succeeded");

  const reusedUrl = new URL(origin + login.callback);
  reusedUrl.searchParams.set("state", "051_CALLBACK_STATE_CANARY_REUSE");
  const reusedCode = client(clientA, {
    path: reusedUrl.pathname + reusedUrl.search,
  });
  assert.ok(
    reusedCode.status >= 400,
    "reused authorization code succeeded with new state",
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

  assert.equal(observe().effects, 0, "denied callbacks caused origin effects");

  // 4. Negative signature & claims controls through pinned proxy
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

  // Live allowlist removal denies re-verification without restart
  const allowlistPath = "/etc/gwrk/secrets/google-account-allowlist";
  const originalAllowlist = readFileSync(allowlistPath, "utf8");
  try {
    writeFileSync(allowlistPath, "other@example.invalid\n", { mode: 0o640 });
    const unlistedSession = client(clientA, { path: "/api/auth/session" });
    assert.ok(
      [401, 403].includes(unlistedSession.status),
      "allowlist removal permitted session re-verification without restart",
    );
  } finally {
    writeFileSync(allowlistPath, originalAllowlist, { mode: 0o640 });
  }

  // 5. Authorization selection & API keys
  for (const row of AUTHORIZATION_SELECTION_CASES) {
    const response = client(clientA, {
      path: "/api/auth/session",
      headers: row.lines,
    });
    if (row.browserEligible)
      assert.equal(
        response.status,
        200,
        "absent caller authorization lost browser eligibility",
      );
    else {
      assert.ok(
        [400, 401, 403].includes(response.status),
        `caller authorization presence fell back to browser: ${row.label}`,
      );
      assert.equal(
        fields(response, "location").length,
        0,
        "invalid API input redirected to browser login",
      );
    }
  }

  // Forged public identity / mode headers and connection-nominated forwarding fields
  for (const forged of [
    ["X-Gwrk-Auth-Mode: api"],
    ["X-Gwrk-Principal-Id: admin", "X-Gwrk-Auth-User: root@example.invalid"],
    ["X-Forwarded-For: 127.0.0.1", "Connection: X-Forwarded-For"],
    ["X-Forwarded-Uri: /", "Connection: X-Forwarded-Uri"],
  ]) {
    const forgedResp = client(clientB, {
      path: "/api/status",
      cookie: false,
      headers: forged,
    });
    assert.ok(
      [400, 401, 403].includes(forgedResp.status),
      "forged public headers bypassed credential verification",
    );
  }

  before = observe();
  const { apiKey, projectId } = JSON.parse(
    readFileSync("/fixture/service/client-input.json", "utf8"),
  );
  const api = client(clientB, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    cookie: false,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.equal(api.status, 200, "valid fixture API key control failed");
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
    const duplicate = client(clientB, {
      path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
      cookie: false,
      headers,
    });
    assert.ok(
      [400, 401, 403].includes(duplicate.status),
      "duplicate caller authorization selected one valid credential",
    );
  }
  const conflict = client(clientA, {
    path: `/api/status?projectId=${encodeURIComponent(projectId)}`,
    headers: [`Authorization: Bearer ${apiKey}`],
  });
  assert.ok(
    [400, 401, 403].includes(conflict.status),
    "API chain dropped session cookies and bypassed conflict denial",
  );
  after = observe();
  assert.equal(
    after.loginAttempts,
    before.loginAttempts,
    "API requests entered the proxy-login admission chain",
  );
  assert.equal(after.effects, 0, "fixture caused an operational effect");

  // 6. Non-zero root admission observations wire check (unfiltered)
  const rootEvents = after.requests.filter((value) => value.path === "/");
  assert.ok(rootEvents.length > 0, "no actual root admission events observed");
  assertAdmissionWire(rootEvents);

  // 7. Quota exhaustion on Client A and independence of Client B
  let quotaHit = false;
  for (let i = 0; i < 65; i++) {
    const res = client(clientA, { path: "/", method: "HEAD" });
    if (res.status === 429) {
      quotaHit = true;
      assert.equal(
        fields(res, "location").length,
        0,
        "429 denial leaked Location",
      );
      assert.equal(
        fields(res, "set-cookie").length,
        0,
        "429 denial leaked Set-Cookie",
      );
      break;
    }
  }
  assert.ok(quotaHit, "Client A quota was not exhausted after 60 checks");
  const clientBCheck = client(clientB, { path: "/", method: "HEAD" });
  assert.equal(
    clientBCheck.status,
    200,
    "Client B was affected by Client A quota exhaustion",
  );

  // Advance rate clock to clear the rate window
  sendControl({ advanceRateMs: 120001 });

  // 8. Shared capacity limit at 1000 buckets
  sendControl({ prefillLoginBuckets: 998 });
  const beforeCrypto = observe().apiCrypto;
  const capacityDenial = client(clientA, {
    path: "/?code=051_CALLBACK_CODE_CANARY",
  });
  assert.equal(
    capacityDenial.status,
    429,
    "capacity limit was not enforced at 1000 buckets",
  );
  assert.equal(
    observe().apiCrypto,
    beforeCrypto,
    "capacity denial performed crypto work",
  );
  sendControl({ advanceRateMs: 120001 });

  // 9. Failures & login faults
  sendControl({ loginFault: "dependency" });
  const depFailure = client(clientA, { path: "/" });
  assert.equal(depFailure.status, 503, "dependency failure did not return 503");
  assert.equal(
    fields(depFailure, "location").length,
    0,
    "dependency denial leaked Location",
  );
  assert.equal(
    fields(depFailure, "set-cookie").length,
    0,
    "dependency denial leaked Set-Cookie",
  );

  sendControl({ loginFault: "connection" });
  const connFailure = client(clientA, { path: "/" });
  assert.ok(
    [500, 502].includes(connFailure.status),
    "connection failure did not return 500/502",
  );
  assert.equal(
    fields(connFailure, "location").length,
    0,
    "connection denial leaked Location",
  );
  assert.equal(
    fields(connFailure, "set-cookie").length,
    0,
    "connection denial leaked Set-Cookie",
  );

  sendControl({ loginFault: "oversized" });
  const overFailure = client(clientA, { path: "/" });
  assert.equal(
    overFailure.status,
    401,
    "oversized admission body did not return 401",
  );
  assert.equal(
    fields(overFailure, "location").length,
    0,
    "oversized denial leaked Location",
  );
  assert.equal(
    fields(overFailure, "set-cookie").length,
    0,
    "oversized denial leaked Set-Cookie",
  );

  sendControl({ loginFault: "none" });

  const cancelledReq = client(clientA, { path: "/", cancelAfterMs: 5 });
  assert.equal(
    cancelledReq.cancelled,
    true,
    "cancelled request did not record cancelled state",
  );

  // 10. Lost response & retries
  const beforeDropped = observe().droppedCommittedResponses;
  sendControl({ dropNextCommitted: true });
  const droppedAttempt = client(clientA, { path: "/" });
  assert.ok(
    [500, 502, 503].includes(droppedAttempt.status) ||
      droppedAttempt.status === 200,
    "drop-next-committed request failed unexpectedly",
  );
  assert.ok(
    observe().droppedCommittedResponses > beforeDropped,
    "drop-next-committed did not trigger socket destruction",
  );

  // 11. Webhook routing & signature
  const webhookSecret = readFileSync(
    "/fixture/service/webhook-secret",
    "utf8",
  ).trim();
  const validPayload = JSON.stringify({
    action: "ping",
    repository: { name: "gwrk" },
  });
  const validSig = `sha256=${createHmac("sha256", webhookSecret).update(validPayload).digest("hex")}`;
  const beforeWebhookLogin = observe().loginAttempts;
  const validWebhook = client(clientB, {
    method: "POST",
    path: "/webhook/github",
    headers: [
      "Content-Type: application/json",
      `X-Hub-Signature-256: ${validSig}`,
    ],
    body: validPayload,
    cookie: false,
  });
  assert.ok(
    [200, 202].includes(validWebhook.status),
    "valid webhook HMAC rejected",
  );
  assert.equal(
    observe().loginAttempts,
    beforeWebhookLogin,
    "webhook triggered login subrequest",
  );

  const badWebhook = client(clientB, {
    method: "POST",
    path: "/webhook/github",
    headers: [
      "Content-Type: application/json",
      "X-Hub-Signature-256: sha256=bad0000000000000000000000000000000000000000000000000000000000000",
      `Authorization: Bearer ${apiKey}`,
    ],
    body: validPayload,
  });
  assert.ok(
    [400, 401, 403].includes(badWebhook.status),
    "bad webhook HMAC accepted",
  );
  assert.equal(
    observe().effects,
    0,
    "denied webhook created operational effects",
  );
  assert.equal(
    observe().rows.dispatch_operations,
    0,
    "denied webhook created dispatch rows",
  );

  // 12. Browser mutations & CSRF
  const freshLogin = await signIn(clientA);
  assert.equal(freshLogin.response.status, 302);

  const headSession = client(clientA, {
    path: "/api/auth/session",
    method: "HEAD",
  });
  assert.equal(headSession.status, 200);
  assert.equal(
    fields(headSession, "set-cookie").length,
    0,
    "HEAD /api/auth/session issued a cookie",
  );

  const getSession = client(clientA, { path: "/api/auth/session" });
  assert.equal(getSession.status, 200);
  const sessionData = JSON.parse(getSession.body);
  assert.ok(sessionData.csrfToken, "GET /api/auth/session omitted csrfToken");
  const csrfToken = sessionData.csrfToken;
  assert.ok(
    fields(getSession, "set-cookie").some((val) =>
      val.includes("__Host-gwrk_csrf="),
    ),
    "GET /api/auth/session omitted __Host-gwrk_csrf cookie",
  );

  const crossOriginLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [
      "Origin: https://evil.example.invalid",
      `x-gwrk-csrf-token: ${csrfToken}`,
    ],
  });
  assert.ok(
    [400, 403].includes(crossOriginLogout.status),
    "cross-origin logout succeeded",
  );

  const missingCsrfLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [`Origin: ${origin}`],
  });
  assert.ok(
    [400, 403].includes(missingCsrfLogout.status),
    "missing CSRF logout succeeded",
  );

  const wrongCsrfLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [`Origin: ${origin}`, "x-gwrk-csrf-token: 051_WRONG_CSRF_CANARY"],
  });
  assert.ok(
    [400, 403].includes(wrongCsrfLogout.status),
    "wrong CSRF logout succeeded",
  );

  sendControl({ logoutFault: true });
  const faultyLogout = client(clientA, {
    method: "POST",
    path: "/api/auth/logout",
    headers: [`Origin: ${origin}`, `x-gwrk-csrf-token: ${csrfToken}`],
  });
  assert.equal(
    faultyLogout.status,
    503,
    "logout proxy failure did not return 503",
  );
  assert.ok(
    observe().originRevokedBeforeProxy > 0,
    "origin revocation did not commit before proxy logout",
  );
  sendControl({ logoutFault: false });

  const revokedSession = client(clientA, { path: "/api/auth/session" });
  assert.ok(
    [401, 403].includes(revokedSession.status),
    "revoked session was accepted on replay",
  );

  // 13. TLS and strict SNI
  const unknownSni = client(
    clientA,
    { path: "/", servername: "unknown.example.invalid" },
    true,
  );
  assert.equal(unknownSni.failed, true, "unknown SNI handshake succeeded");

  const nullSni = client(clientA, { path: "/", servername: null }, true);
  assert.equal(nullSni.failed, true, "missing SNI handshake succeeded");

  // 14. Log canaries and leak assertions
  assert.equal(
    canaries.some(
      (c) => session.body.includes(c) || getSession.body.includes(c),
    ),
    false,
    "canary leaked in response body",
  );

  // 15. Native observation verification if file exists
  const observationPath = "/fixture/service/native-observation.json";
  if (existsSync(observationPath)) {
    const raw = JSON.parse(readFileSync(observationPath, "utf8"));
    validateNativeObservation(raw, {
      runId: process.env.GWRK_051_RUN_ID,
      proxyImageId: process.env.GWRK_051_PROXY_IMAGE_ID,
      traefikImageId: process.env.GWRK_051_TRAEFIK_IMAGE_ID,
      runtimeReceiptSha256: process.env.GWRK_051_RUNTIME_RECEIPT_SHA256,
    });
  }

  process.stdout.write(
    `${JSON.stringify({ event: "gateway_partial_native_assertions_passed", acceptanceComplete: false })}\n`,
  );
} catch {
  // Raw IPC includes synthetic credentials and callbacks. Never dump it or error messages.
  process.stderr.write(
    "Gateway native fixture assertion failed. Inspect safe counters and sanitized logs.\n",
  );
  process.exitCode = 1;
}
