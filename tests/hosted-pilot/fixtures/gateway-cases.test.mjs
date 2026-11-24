import assert from "node:assert/strict";
import { test } from "vitest";
import {
  assertAdmissionWire,
  parseFixtureControl,
  validateNativeObservation,
} from "./raw-https.mjs";

const wire = {
  path: "/",
  method: "GET",
  peer: "127.0.0.1",
  hasQuery: false,
  hasBody: false,
  hasAuthorization: false,
  hasCookie: false,
  forwardedUriIsRoot: true,
  forwardedMethodIsGet: true,
  forwardedFor: "172.31.51.11",
  forwardedForCount: 1,
};
const expected = {
  runId: "a".repeat(24),
  proxyImageId: `sha256:${"b".repeat(64)}`,
  traefikImageId: `sha256:${"c".repeat(64)}`,
  runtimeReceiptSha256: "d".repeat(64),
};
const observation = () => ({
  version: 1,
  provenance: { ...expected, source: "passive_tcp", namespace: "owned_nested" },
  proxyRequests: [],
  sequence: 1,
});

test("root-wire checks require actual nonempty observations and inspect every root event", () => {
  assert.throws(() => assertAdmissionWire([]));
  assert.doesNotThrow(() => assertAdmissionWire([wire]));
  for (const mutation of [
    { forwardedUriIsRoot: false },
    { hasQuery: true },
    { hasBody: true },
    { hasAuthorization: true },
    { hasCookie: true },
    { forwardedFor: "172.31.51.11, 172.31.51.12" },
    { forwardedForCount: 2 },
    { peer: "172.31.51.11" },
    { method: "POST" },
  ])
    assert.throws(() => assertAdmissionWire([wire, { ...wire, ...mutation }]));
});

test("private controls are bounded, monotonic inputs with no request authority", () => {
  assert.deepEqual(
    parseFixtureControl({
      sequence: 1,
      advanceRateMs: 120001,
      prefillLoginBuckets: 998,
      loginFault: "none",
    }),
    {
      sequence: 1,
      advanceRateMs: 120001,
      prefillLoginBuckets: 998,
      loginFault: "none",
    },
  );
  for (const value of [
    null,
    {},
    { sequence: 0 },
    { sequence: 1, advanceRateMs: -1 },
    { sequence: 1, advanceRateMs: 120002 },
    { sequence: 1, prefillLoginBuckets: 1001 },
    { sequence: 1, loginFault: "allow" },
    { sequence: 1, trustedIp: "spoof" },
    { sequence: 1, apiKey: "secret" },
  ])
    assert.throws(() => parseFixtureControl(value));
});

test("native wire receipts require exact runtime provenance, bounded events and no raw query/secrets", () => {
  assert.doesNotThrow(() => validateNativeObservation(observation(), expected));
  for (const mutation of [
    {},
    {
      ...observation(),
      provenance: { ...observation().provenance, runId: "e".repeat(24) },
    },
    { ...observation(), sequence: -1 },
    { ...observation(), proxyRequests: [{ sequence: 1, query: "raw-secret" }] },
  ])
    assert.throws(() => validateNativeObservation(mutation, expected));
});

test("private controls validate boolean flags and reject non-boolean fault overrides", () => {
  assert.deepEqual(
    parseFixtureControl({
      sequence: 2,
      logoutFault: true,
      dropNextCommitted: false,
    }),
    { sequence: 2, logoutFault: true, dropNextCommitted: false },
  );
  assert.throws(() => parseFixtureControl({ sequence: 2, logoutFault: "yes" }));
  assert.throws(() =>
    parseFixtureControl({ sequence: 2, dropNextCommitted: 1 }),
  );
  assert.throws(() =>
    parseFixtureControl({ sequence: 2, unknownControl: true }),
  );
});

test("native wire receipts enforce strict path allowlist and reject raw secrets or unordered sequences", () => {
  const base = observation();
  assert.throws(() =>
    validateNativeObservation(
      {
        ...base,
        proxyRequests: [
          {
            sequence: 1,
            method: "GET",
            path: "/admin",
            querySha256: "a".repeat(64),
            cookieSha256: "b".repeat(64),
            peer: "127.0.0.1",
            forwardedFor: "172.31.51.11",
            forwardedForCount: 1,
            hasForwardedUri: false,
            hasForwardedMethod: false,
          },
        ],
      },
      expected,
    ),
  );
  assert.throws(() =>
    validateNativeObservation(
      {
        ...base,
        proxyRequests: [
          {
            sequence: 2,
            method: "GET",
            path: "/oauth2/start",
            querySha256: "a".repeat(64),
            cookieSha256: "b".repeat(64),
            peer: "127.0.0.1",
            forwardedFor: "172.31.51.11",
            forwardedForCount: 1,
            hasForwardedUri: false,
            hasForwardedMethod: false,
          },
          {
            sequence: 1,
            method: "GET",
            path: "/oauth2/start",
            querySha256: "a".repeat(64),
            cookieSha256: "b".repeat(64),
            peer: "127.0.0.1",
            forwardedFor: "172.31.51.11",
            forwardedForCount: 1,
            hasForwardedUri: false,
            hasForwardedMethod: false,
          },
        ],
      },
      expected,
    ),
  );
});
