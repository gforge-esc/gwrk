import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { AUTHORIZATION_SELECTION_CASES } from "./raw-https.mjs";

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
];
const observe = () =>
  JSON.parse(readFileSync("/fixture/service/observations.json", "utf8"));
const fields = (response, name) =>
  response.fields
    .filter(([key]) => key === name.toLowerCase())
    .map(([, value]) => value);
function client(name, command) {
  const raw = execFileSync(
    "docker",
    ["exec", "--interactive", name, "node", "/fixture/fixtures/client.mjs"],
    {
      input: JSON.stringify(command),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 131072,
    },
  );
  const result = JSON.parse(raw);
  assert.equal(result.failed, undefined, "native client request failed");
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
function issuerAuthorize(location) {
  const url = new URL(location);
  assert.equal(url.origin, "https://127.0.0.1:18443");
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
async function signIn(name, mutateCallback = (value) => value) {
  const start = client(name, {
    path: "/oauth2/start?rd=%2Fapi%2Fauth%2Fsession",
  });
  assert.equal(
    start.status,
    302,
    "proxy start did not redirect to the verified fixture issuer",
  );
  const callback = await issuerAuthorize(fields(start, "location")[0]);
  const url = new URL(mutateCallback(callback));
  assert.equal(url.origin, origin);
  return {
    response: client(name, { path: url.pathname + url.search }),
    callback: url.pathname + url.search,
  };
}
try {
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
  const replay = client(clientA, { path: login.callback });
  assert.ok(replay.status >= 400, "replayed callback succeeded");

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
  const wrongState = await signIn(clientB, (callback) => {
    const value = new URL(callback);
    value.searchParams.set("state", "051_CALLBACK_STATE_CANARY");
    return value.href;
  });
  assert.ok(
    wrongState.response.status >= 400,
    "wrong callback state succeeded",
  );

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
  for (const event of after.requests.filter(
    (value) => value.path === "/" && value.forwardedUriIsRoot,
  )) {
    assert.equal(
      event.peer,
      "127.0.0.1",
      "origin saw an unexpected gateway peer",
    );
    assert.equal(event.hasQuery, false, "admission wire included caller query");
    assert.equal(
      event.hasAuthorization,
      false,
      "admission wire included authorization",
    );
    assert.equal(event.hasCookie, false, "admission wire included cookies");
    assert.ok(
      ["172.31.51.11", "172.31.51.12"].includes(event.forwardedFor),
      "admission lost actual peer identity",
    );
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
