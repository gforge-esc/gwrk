import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "vitest";
import {
  CALLBACK,
  CLIENT_ID,
  GOOGLE_ISSUER,
  createFixtureIssuer,
} from "./issuer.mjs";

async function request(fixture, method, path, body = "", headers = {}) {
  const req = Readable.from([body]);
  Object.assign(req, { method, url: path, headers });
  let status;
  let responseHeaders;
  let output = "";
  const res = {
    writeHead(value, fields) {
      status = value;
      responseHeaders = fields;
      return this;
    },
    end(value = "") {
      output += value;
      return this;
    },
  };
  await fixture.handler(req, res);
  return { status, headers: responseHeaders, body: output };
}
const verifier = "v".repeat(64);
async function grant(fixture, selected = "valid") {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: "opaque-state",
    nonce: "opaque-nonce",
    fixture_case: selected,
  });
  const start = await request(fixture, "GET", `/authorize?${params}`);
  assert.equal(start.status, 302);
  const redirect = new URL(start.headers.Location);
  assert.equal(redirect.origin + redirect.pathname, CALLBACK);
  assert.equal(redirect.searchParams.get("state"), "opaque-state");
  return new URLSearchParams({
    code: redirect.searchParams.get("code"),
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: CALLBACK,
    client_id: CLIENT_ID,
    client_secret: "fixture-secret",
  });
}

test("signs Google issuer and audience with real RS256 and the supplied nonce", async () => {
  const fixture = createFixtureIssuer({ clientSecret: "fixture-secret" });
  const result = await request(fixture, "POST", "/token", await grant(fixture));
  assert.equal(result.status, 200);
  const jwt = JSON.parse(result.body).id_token;
  const [header, payload, signature] = jwt.split(".");
  const jwks = JSON.parse((await request(fixture, "GET", "/jwks")).body);
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      createPublicKey({ key: jwks.keys[0], format: "jwk" }),
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, GOOGLE_ISSUER);
  assert.equal(claims.aud, CLIENT_ID);
  assert.equal(claims.nonce, "opaque-nonce");
  assert.equal(claims.email_verified, true);
  assert.deepEqual(fixture.counters(), {
    authorize: 1,
    token: 1,
    issued: 1,
    denied: 0,
    jwks: 1,
    pendingCodes: 0,
  });
});

test("one-use codes reject replay and failed PKCE consumes the code", async () => {
  const fixture = createFixtureIssuer({ clientSecret: "fixture-secret" });
  const body = await grant(fixture);
  const wrong = new URLSearchParams(body);
  wrong.set("code_verifier", "w".repeat(64));
  assert.equal((await request(fixture, "POST", "/token", wrong)).status, 400);
  assert.equal((await request(fixture, "POST", "/token", body)).status, 400);
  const valid = await grant(fixture);
  assert.equal((await request(fixture, "POST", "/token", valid)).status, 200);
  assert.equal((await request(fixture, "POST", "/token", valid)).status, 400);
});

test("expired grants and wrong clients fail without reflection", async () => {
  let now = 1000;
  const fixture = createFixtureIssuer({
    clientSecret: "fixture-secret",
    now: () => now,
  });
  const body = await grant(fixture);
  now += 300_001;
  assert.equal((await request(fixture, "POST", "/token", body)).status, 400);
  const second = await grant(fixture);
  second.set("client_secret", "secret-canary");
  const denied = await request(fixture, "POST", "/token", second);
  assert.equal(denied.status, 400);
  assert.equal(denied.body, '{"error":"invalid_request"}');
  assert.equal(
    JSON.stringify(fixture.counters()).includes("secret-canary"),
    false,
  );
});

test("negative token controls change only their selected verification boundary", async () => {
  const fixture = createFixtureIssuer({ clientSecret: "fixture-secret" });
  const jwks = JSON.parse((await request(fixture, "GET", "/jwks")).body);
  const key = createPublicKey({ key: jwks.keys[0], format: "jwk" });
  for (const selected of [
    "wrong-nonce",
    "missing-nonce",
    "wrong-audience",
    "wrong-issuer",
    "wrong-signature",
    "expired",
    "unverified",
    "unlisted",
  ]) {
    const result = await request(
      fixture,
      "POST",
      "/token",
      await grant(fixture, selected),
    );
    assert.equal(result.status, 200);
    const [header, payload, signature] = JSON.parse(result.body).id_token.split(
      ".",
    );
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        key,
        Buffer.from(signature, "base64url"),
      ),
      selected !== "wrong-signature",
    );
    assert.equal(claims.iss === GOOGLE_ISSUER, selected !== "wrong-issuer");
    assert.equal(claims.aud === CLIENT_ID, selected !== "wrong-audience");
    assert.equal(
      claims.nonce === "opaque-nonce",
      !["wrong-nonce", "missing-nonce"].includes(selected),
    );
    assert.equal(claims.exp > Date.now() / 1000, selected !== "expired");
    assert.equal(claims.email_verified, selected !== "unverified");
    assert.equal(
      claims.email === "allowed@example.invalid",
      selected !== "unlisted",
    );
  }
});

test("token observation exposes digests rather than raw token material", async () => {
  const observed = [];
  const fixture = createFixtureIssuer({
    clientSecret: "fixture-secret",
    onIssuedToken: (value) => observed.push(value),
  });
  const result = await request(fixture, "POST", "/token", await grant(fixture));
  assert.equal(result.status, 200);
  assert.equal(observed.length, 1);
  assert.match(observed[0].idTokenSha256, /^[a-f0-9]{64}$/);
  assert.match(observed[0].accessTokenSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(observed).includes(JSON.parse(result.body).id_token),
    false,
  );
});

test("token-error control preserves its synthetic upstream canary for gateway logging tests", async () => {
  const fixture = createFixtureIssuer({ clientSecret: "fixture-secret" });
  const result = await request(
    fixture,
    "POST",
    "/token",
    await grant(fixture, "token-error"),
  );
  assert.equal(result.status, 400);
  assert.ok(result.body.includes("051_UPSTREAM_ERROR_CANARY"));
});
