import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "vitest";
import {
  buildHealthSidecar,
  buildV1Snapshot,
  createObserverState,
  ingestPacket,
  matchBarrier,
  recordStats,
} from "./native-observer-parser.mjs";
import { validateNativeObservation } from "./raw-https.mjs";

const PROVENANCE = {
  runId: "0123456789abcdef01234567",
  proxyImageId: `sha256:${"a".repeat(64)}`,
  traefikImageId: `sha256:${"b".repeat(64)}`,
  runtimeReceiptSha256: "c".repeat(64),
};

const SENTINEL_PORT = 49152;
const ETH_P_IP = 0x0800;
const ETH_P_IPV6 = 0x86dd;
const PACKET_HOST = 0;
const PACKET_OUTGOING = 4;

const TCP_FIN = 0x01;
const TCP_SYN = 0x02;
const TCP_RST = 0x04;
const TCP_PSH = 0x08;
const TCP_ACK = 0x10;

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function ipToBytes(ip) {
  return ip.split(".").map((part) => Number.parseInt(part, 10));
}

function ipv4Packet({
  srcIp = "127.0.0.1",
  dstIp = "127.0.0.1",
  proto,
  flagsFrag = 0,
  optionsBytes = 0,
  l4Payload,
}) {
  assert.equal(optionsBytes % 4, 0);
  const ihlBytes = 20 + optionsBytes;
  const totalLen = ihlBytes + l4Payload.length;
  const header = Buffer.alloc(ihlBytes);
  header[0] = (4 << 4) | (ihlBytes / 4);
  header.writeUInt16BE(totalLen, 2);
  header.writeUInt16BE(flagsFrag, 6);
  header[8] = 64;
  header[9] = proto;
  const src = ipToBytes(srcIp);
  const dst = ipToBytes(dstIp);
  for (let i = 0; i < 4; i++) {
    header[12 + i] = src[i];
    header[16 + i] = dst[i];
  }
  return Buffer.concat([header, l4Payload]);
}

function tcpPacket({
  srcIp = "127.0.0.1",
  dstIp = "127.0.0.1",
  srcPort,
  dstPort,
  seq = 1000,
  ack = 0,
  flags = TCP_ACK,
  payload = Buffer.alloc(0),
  flagsFrag = 0,
  optionsBytes = 0,
}) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  const tcp = Buffer.alloc(20 + data.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp.writeUInt32BE(ack >>> 0, 8);
  tcp[12] = 5 << 4;
  tcp[13] = flags;
  tcp.writeUInt16BE(65535, 14);
  data.copy(tcp, 20);
  return ipv4Packet({
    srcIp,
    dstIp,
    proto: 6,
    flagsFrag,
    optionsBytes,
    l4Payload: tcp,
  });
}

function udpPacket({
  srcIp = "127.0.0.1",
  dstIp = "127.0.0.1",
  srcPort = 51000,
  dstPort = SENTINEL_PORT,
  payload = Buffer.alloc(0),
  flagsFrag = 0,
}) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  const udp = Buffer.alloc(8 + data.length);
  udp.writeUInt16BE(srcPort, 0);
  udp.writeUInt16BE(dstPort, 2);
  udp.writeUInt16BE(8 + data.length, 4);
  data.copy(udp, 8);
  return ipv4Packet({
    srcIp,
    dstIp,
    proto: 17,
    flagsFrag,
    l4Payload: udp,
  });
}

function ipv6TcpPacket({
  nextHeader = 6,
  srcPort = 52000,
  dstPort = 4180,
  payload = Buffer.alloc(0),
}) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload, "utf8");
  const ip6 = Buffer.alloc(40);
  ip6[0] = 0x60;
  ip6.writeUInt16BE(20 + data.length, 4);
  ip6[6] = nextHeader;
  ip6[7] = 64;
  ip6[23] = 1; // ::1
  ip6[39] = 1; // ::1
  const tcp = Buffer.alloc(20 + data.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp[12] = 5 << 4;
  tcp[13] = TCP_SYN;
  data.copy(tcp, 20);
  return Buffer.concat([ip6, tcp]);
}

function feed(state, payload, opts = {}) {
  return ingestPacket(state, {
    pkttype: opts.pkttype ?? PACKET_HOST,
    ethProto: opts.ethProto ?? ETH_P_IP,
    monotonicNs: opts.monotonicNs ?? 1000n,
    origLen: opts.origLen ?? payload.length,
    payload,
  });
}

function completeOriginHandshake(
  state,
  srcPort,
  clientIsn = 1000,
  serverIsn = 5000,
) {
  feed(
    state,
    tcpPacket({ srcPort, dstPort: 18790, seq: clientIsn, flags: TCP_SYN }),
  );
  feed(
    state,
    tcpPacket({
      srcPort: 18790,
      dstPort: srcPort,
      seq: serverIsn,
      ack: (clientIsn + 1) >>> 0,
      flags: TCP_SYN | TCP_ACK,
    }),
  );
  feed(
    state,
    tcpPacket({
      srcPort,
      dstPort: 18790,
      seq: (clientIsn + 1) >>> 0,
      ack: (serverIsn + 1) >>> 0,
      flags: TCP_ACK,
    }),
  );
}

function emitSentinelAndMatch(
  state,
  barrierSequence,
  nonce = "0123456789abcdef",
) {
  const expectedPayload = `GWRK051:${PROVENANCE.runId}:${barrierSequence}:${nonce}`;
  feed(state, udpPacket({ dstPort: SENTINEL_PORT, payload: expectedPayload }));
  return matchBarrier(state, { barrierSequence, expectedPayload });
}

function makeState(limits) {
  const state = createObserverState({
    provenance: PROVENANCE,
    sentinelPort: SENTINEL_PORT,
    limits,
  });
  recordStats(state, {
    kernelPackets: 1,
    kernelDrops: 0,
    effectiveRcvBufBytes: 1048576,
    ignoreOutgoingKernelEnabled: true,
    pkttypeBpfFallbackActive: false,
  });
  return state;
}

describe("native-observer-parser pure behavioral contract", () => {
  test("OBS-01: reassembles split, out-of-order, overlapping, retransmitted, and u32-wrapped TCP segments", () => {
    const state = makeState();
    const rawQuery = "code=CANARY_CODE_01&state=CANARY_STATE_01";
    const req = [
      `GET /oauth2/callback?${rawQuery} HTTP/1.1`,
      "Host: 127.0.0.1:4180",
      "X-Forwarded-For: 172.31.51.11",
      "Cookie: _oauth2_proxy_csrf=CANARY_CSRF_01",
      "Cookie:  extra=CANARY_EXTRA_01 \t",
      "",
      "",
    ].join("\r\n");
    const buf = Buffer.from(req, "utf8");
    const part1 = buf.subarray(0, 22);
    const part2 = buf.subarray(16, 65); // overlaps 6 bytes with part1
    const part3 = buf.subarray(65);
    const isn = 0xfffffff0; // forces 32-bit sequence wraparound across the request

    feed(
      state,
      tcpPacket({ srcPort: 41001, dstPort: 4180, seq: isn, flags: TCP_SYN }),
    );
    // Deliver part3 first (out of order), then duplicate part3, then part2, then part1, then duplicate part1
    const seq1 = (isn + 1) >>> 0;
    const seq2 = (seq1 + 16) >>> 0;
    const seq3 = (seq1 + 65) >>> 0;
    feed(
      state,
      tcpPacket({
        srcPort: 41001,
        dstPort: 4180,
        seq: seq3,
        flags: TCP_PSH | TCP_ACK,
        payload: part3,
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 41001,
        dstPort: 4180,
        seq: seq3,
        flags: TCP_PSH | TCP_ACK,
        payload: part3,
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 41001,
        dstPort: 4180,
        seq: seq2,
        flags: TCP_ACK,
        payload: part2,
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 41001,
        dstPort: 4180,
        seq: seq1,
        flags: TCP_ACK,
        payload: part1,
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 41001,
        dstPort: 4180,
        seq: seq1,
        flags: TCP_ACK,
        payload: part1,
      }),
    );

    const barrierRes = emitSentinelAndMatch(state, 1);
    assert.equal(barrierRes.matched, true);
    assert.equal(barrierRes.barrierSequence, 1);

    const snapshot = buildV1Snapshot(state);
    assert.doesNotThrow(() =>
      validateNativeObservation(snapshot, PROVENANCE, {
        minBarrierSequence: 1,
      }),
    );
    assert.equal(snapshot.proxyRequests.length, 1);
    assert.deepEqual(snapshot.proxyRequests[0], {
      sequence: 1,
      method: "GET",
      path: "/oauth2/callback",
      querySha256: sha256(rawQuery),
      cookieSha256: sha256(
        "_oauth2_proxy_csrf=CANARY_CSRF_01; extra=CANARY_EXTRA_01",
      ),
      peer: "127.0.0.1",
      forwardedFor: "172.31.51.11",
      forwardedForCount: 1,
      hasForwardedUri: false,
      hasForwardedMethod: false,
    });
  });

  test("OBS-02: discards PACKET_OUTGOING frames to prevent loopback double counting", () => {
    const state = makeState();
    const syn = tcpPacket({
      srcPort: 41002,
      dstPort: 4180,
      seq: 100,
      flags: TCP_SYN,
    });
    const req = tcpPacket({
      srcPort: 41002,
      dstPort: 4180,
      seq: 101,
      flags: TCP_PSH | TCP_ACK,
      payload:
        "GET /oauth2/start?rd=%2F HTTP/1.1\r\n" +
        "Host: 127.0.0.1:4180\r\n" +
        "X-Forwarded-For: 172.31.51.11\r\n\r\n",
    });

    feed(state, syn, { pkttype: PACKET_OUTGOING });
    feed(state, syn, { pkttype: PACKET_HOST });
    feed(state, req, { pkttype: PACKET_OUTGOING });
    feed(state, req, { pkttype: PACKET_HOST });

    const snapshot = buildV1Snapshot(state);
    assert.equal(snapshot.proxyRequests.length, 1);
    assert.equal(snapshot.sequence, 1);
  });

  test("OBS-03: streams and skips Content-Length and chunked bodies on keep-alive connections without persisting body bytes or secrets", () => {
    const state = makeState();
    const clBody = "secret_body_token=CL_CANARY_SECRET_777";
    const chunkBody = "chunk_secret=CHUNK_CANARY_SECRET_888";
    const chunkedWire = `${chunkBody.length.toString(16)};ext=1\r\n${chunkBody}\r\n0\r\nX-Trailer: ignored\r\n\r\n`;
    const stream = [
      [
        "POST /oauth2/auth HTTP/1.1",
        "Host: 127.0.0.1:4180",
        `Content-Length: ${Buffer.byteLength(clBody)}`,
        "X-Forwarded-For: 172.31.51.11",
        "X-Forwarded-Uri: /api/auth/session",
        "X-Forwarded-Method: POST",
        "Authorization: Bearer AUTH_CANARY_SECRET_999",
        "Cookie: sid=COOKIE_CANARY_SECRET_555",
        "",
        clBody,
      ].join("\r\n"),
      [
        "POST /oauth2/auth HTTP/1.1",
        "Host: 127.0.0.1:4180",
        "Transfer-Encoding: chunked",
        "X-Forwarded-For: 172.31.51.12",
        "X-Forwarded-Uri: /api/projects",
        "X-Forwarded-Method: POST",
        "",
        chunkedWire,
      ].join("\r\n"),
      ["GET /oauth2/sign_out HTTP/1.1", "Host: 127.0.0.1:4180", "", ""].join(
        "\r\n",
      ),
    ].join("");

    feed(
      state,
      tcpPacket({ srcPort: 41003, dstPort: 4180, seq: 500, flags: TCP_SYN }),
    );
    // Split mid-body and mid-chunk to verify streaming state transitions
    const bytes = Buffer.from(stream, "utf8");
    let seq = 501;
    for (let offset = 0; offset < bytes.length; offset += 19) {
      const slice = bytes.subarray(offset, offset + 19);
      feed(
        state,
        tcpPacket({
          srcPort: 41003,
          dstPort: 4180,
          seq,
          flags: TCP_ACK,
          payload: slice,
        }),
      );
      seq = (seq + slice.length) >>> 0;
    }

    const snapshot = buildV1Snapshot(state);
    const health = buildHealthSidecar(state);
    assert.equal(health.captureStats.integrityFaultCode, null);
    assert.equal(snapshot.proxyRequests.length, 3);
    assert.equal(snapshot.proxyRequests[0].method, "POST");
    assert.equal(snapshot.proxyRequests[0].path, "/oauth2/auth");
    assert.equal(snapshot.proxyRequests[0].hasForwardedUri, true);
    assert.equal(snapshot.proxyRequests[0].hasForwardedMethod, true);
    assert.equal(snapshot.proxyRequests[1].forwardedFor, "172.31.51.12");
    assert.equal(snapshot.proxyRequests[2].path, "/oauth2/sign_out");
    assert.equal(snapshot.proxyRequests[2].forwardedForCount, 0);
    assert.equal(snapshot.proxyRequests[2].forwardedFor, "");

    const serializedAll = JSON.stringify({
      snapshot,
      health,
      flows: [...state.activeFlows.values()],
      sentinels: state.observedSentinels,
    });
    for (const canary of [
      "CL_CANARY_SECRET_777",
      "CHUNK_CANARY_SECRET_888",
      "AUTH_CANARY_SECRET_999",
      "COOKIE_CANARY_SECRET_555",
    ]) {
      assert.equal(
        serializedAll.includes(canary),
        false,
        `secret leaked: ${canary}`,
      );
    }
  });

  test("OBS-03b: latches BODY_LIMIT_EXCEEDED when Content-Length or chunked body exceeds 1 MiB", () => {
    const stateCl = makeState();
    feed(
      stateCl,
      tcpPacket({ srcPort: 41004, dstPort: 4180, seq: 10, flags: TCP_SYN }),
    );
    feed(
      stateCl,
      tcpPacket({
        srcPort: 41004,
        dstPort: 4180,
        seq: 11,
        flags: TCP_ACK,
        payload:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Content-Length: 1048577\r\n\r\n",
      }),
    );
    assert.equal(
      buildHealthSidecar(stateCl).captureStats.integrityFaultCode,
      "BODY_LIMIT_EXCEEDED",
    );

    const stateChunk = makeState();
    feed(
      stateChunk,
      tcpPacket({ srcPort: 41005, dstPort: 4180, seq: 10, flags: TCP_SYN }),
    );
    feed(
      stateChunk,
      tcpPacket({
        srcPort: 41005,
        dstPort: 4180,
        seq: 11,
        flags: TCP_ACK,
        payload:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Transfer-Encoding: chunked\r\n\r\n" +
          "100001\r\n",
      }),
    );
    assert.equal(
      buildHealthSidecar(stateChunk).captureStats.integrityFaultCode,
      "BODY_LIMIT_EXCEEDED",
    );
  });

  test("OBS-04: allows 0-byte handshake closes while latching MID_HEADER_CLOSE on partial FIN or RST on port 4180", () => {
    const clean = makeState();
    // 0-byte handshake close on port 4180 does not fault
    feed(
      clean,
      tcpPacket({ srcPort: 41010, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    feed(
      clean,
      tcpPacket({
        srcPort: 41010,
        dstPort: 4180,
        seq: 101,
        flags: TCP_FIN | TCP_ACK,
      }),
    );
    // 0-byte handshake close on port 18790 increments zeroByteClosedConnections
    completeOriginHandshake(clean, 41011, 200, 600);
    feed(
      clean,
      tcpPacket({
        srcPort: 41011,
        dstPort: 18790,
        seq: 201,
        ack: 601,
        flags: TCP_FIN | TCP_ACK,
      }),
    );
    const cleanHealth = buildHealthSidecar(clean);
    assert.equal(cleanHealth.captureStats.integrityFaultCode, null);
    assert.equal(cleanHealth.originTcpSummary.zeroByteClosedConnections, 1);

    // Mid-header FIN on port 4180 latches MID_HEADER_CLOSE
    const midFin = makeState();
    feed(
      midFin,
      tcpPacket({ srcPort: 41012, dstPort: 4180, seq: 300, flags: TCP_SYN }),
    );
    feed(
      midFin,
      tcpPacket({
        srcPort: 41012,
        dstPort: 4180,
        seq: 301,
        flags: TCP_FIN | TCP_ACK,
        payload: "GET /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n",
      }),
    );
    assert.equal(
      buildHealthSidecar(midFin).captureStats.integrityFaultCode,
      "MID_HEADER_CLOSE",
    );
    assert.equal(emitSentinelAndMatch(midFin, 1).matched, false);

    // Mid-header RST on port 4180 latches MID_HEADER_CLOSE
    const midRst = makeState();
    feed(
      midRst,
      tcpPacket({ srcPort: 41013, dstPort: 4180, seq: 400, flags: TCP_SYN }),
    );
    feed(
      midRst,
      tcpPacket({
        srcPort: 41013,
        dstPort: 4180,
        seq: 401,
        flags: TCP_ACK,
        payload: "GET /oauth2/start HTTP/1.1\r\nCookie: secret=DO_NOT_LEAK\r\n",
      }),
    );
    feed(
      midRst,
      tcpPacket({ srcPort: 41013, dstPort: 4180, seq: 457, flags: TCP_RST }),
    );
    const rstHealth = buildHealthSidecar(midRst);
    assert.equal(rstHealth.captureStats.integrityFaultCode, "MID_HEADER_CLOSE");
    assert.equal(JSON.stringify(rstHealth).includes("DO_NOT_LEAK"), false);
  });

  test("OBS-05: enforces bc6ee272 wire parity across /oauth2 routes, ForwardAuth flags, and allowlist fallbacks", () => {
    const state = makeState();
    feed(
      state,
      tcpPacket({ srcPort: 41020, dstPort: 4180, seq: 1000, flags: TCP_SYN }),
    );
    const reqs =
      "GET /oauth2/start?rd=%2Fapi%2Fauth%2Fsession HTTP/1.1\r\n" +
      "Host: 127.0.0.1:4180\r\n" +
      "X-Forwarded-For: 172.31.51.11\r\n\r\n" +
      "GET /oauth2/auth HTTP/1.1\r\n" +
      "Host: 127.0.0.1:4180\r\n" +
      "X-Forwarded-For: 172.31.51.11\r\n" +
      "X-Forwarded-Uri: /api/auth/session\r\n" +
      "X-Forwarded-Method: GET\r\n\r\n" +
      "GET /oauth2/sign_out HTTP/1.1\r\n" +
      "Host: 127.0.0.1:4180\r\n\r\n";

    feed(
      state,
      tcpPacket({
        srcPort: 41020,
        dstPort: 4180,
        seq: 1001,
        flags: TCP_ACK,
        payload: reqs,
      }),
    );
    assert.equal(emitSentinelAndMatch(state, 1).matched, true);

    const snapshot = buildV1Snapshot(state);
    assert.deepEqual(Object.keys(snapshot).sort(), [
      "barrierSequence",
      "provenance",
      "proxyRequests",
      "sequence",
      "version",
    ]);
    assert.doesNotThrow(() =>
      validateNativeObservation(snapshot, PROVENANCE, {
        minBarrierSequence: 1,
      }),
    );
    assert.equal(snapshot.proxyRequests[0].hasForwardedUri, false);
    assert.equal(snapshot.proxyRequests[0].hasForwardedMethod, false);
    assert.equal(snapshot.proxyRequests[0].cookieSha256, sha256(""));
    assert.equal(snapshot.proxyRequests[1].path, "/oauth2/auth");
    assert.equal(snapshot.proxyRequests[1].hasForwardedUri, true);
    assert.equal(snapshot.proxyRequests[1].hasForwardedMethod, true);
    assert.equal(snapshot.proxyRequests[2].path, "/oauth2/sign_out");
    assert.equal(snapshot.proxyRequests[2].forwardedForCount, 0);
    assert.equal(snapshot.proxyRequests[2].forwardedFor, "");

    // Unexpected method, path, and multi/invalid X-Forwarded-For map to explicit sentinel strings
    const adv = makeState();
    feed(
      adv,
      tcpPacket({ srcPort: 41021, dstPort: 4180, seq: 10, flags: TCP_SYN }),
    );
    feed(
      adv,
      tcpPacket({
        srcPort: 41021,
        dstPort: 4180,
        seq: 11,
        flags: TCP_ACK,
        payload:
          "DELETE /secret/admin?token=CANARY_ADMIN_1 HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "X-Forwarded-For: 172.31.51.11, 10.0.0.1\r\n\r\n" +
          "GET /oauth2/start HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "X-Forwarded-For: 172.31.51.11\r\n" +
          "X-Forwarded-For: 172.31.51.12\r\n\r\n",
      }),
    );
    const advSnap = buildV1Snapshot(adv);
    assert.equal(advSnap.proxyRequests[0].method, "UNEXPECTED_METHOD");
    assert.equal(advSnap.proxyRequests[0].path, "UNEXPECTED_PATH");
    assert.equal(advSnap.proxyRequests[0].forwardedForCount, 1);
    assert.equal(advSnap.proxyRequests[0].forwardedFor, "INVALID");
    assert.equal(advSnap.proxyRequests[1].forwardedForCount, 2);
    assert.equal(advSnap.proxyRequests[1].forwardedFor, "INVALID");
    assert.equal(JSON.stringify(advSnap).includes("CANARY_ADMIN_1"), false);
    assert.equal(JSON.stringify(advSnap).includes("/secret/admin"), false);
  });

  test("OBS-06: latches sticky faults for every RFC 9112 smuggling defect, IPv4 fragment, and accidental IPv6 traffic", () => {
    const cases = [
      {
        label: "bare LF",
        wire: "GET /oauth2/start HTTP/1.1\nHost: 127.0.0.1:4180\r\n\r\n",
        code: "RFC9112_BARE_LF",
      },
      {
        label: "obs-fold space",
        wire: "GET /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n folded: yes\r\n\r\n",
        code: "RFC9112_OBS_FOLD",
      },
      {
        label: "obs-fold tab",
        wire: "GET /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\tfolded: yes\r\n\r\n",
        code: "RFC9112_OBS_FOLD",
      },
      {
        label: "whitespace before colon",
        wire: "GET /oauth2/start HTTP/1.1\r\nHost : 127.0.0.1:4180\r\n\r\n",
        code: "RFC9112_INVALID_HEADER_NAME",
      },
      {
        label: "empty header name",
        wire: "GET /oauth2/start HTTP/1.1\r\n: value\r\n\r\n",
        code: "RFC9112_INVALID_HEADER_NAME",
      },
      {
        label: "CL and TE conflict",
        wire:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Content-Length: 4\r\n" +
          "Transfer-Encoding: chunked\r\n\r\n",
        code: "RFC9112_CL_TE_CONFLICT",
      },
      {
        label: "conflicting Content-Length",
        wire:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Content-Length: 4\r\n" +
          "Content-Length: 8\r\n\r\n",
        code: "RFC9112_INVALID_CONTENT_LENGTH",
      },
      {
        label: "non-digit Content-Length",
        wire:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Content-Length: +4\r\n\r\n",
        code: "RFC9112_INVALID_CONTENT_LENGTH",
      },
      {
        label: "unsupported Transfer-Encoding",
        wire:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Transfer-Encoding: gzip, chunked\r\n\r\n",
        code: "RFC9112_UNSUPPORTED_TE",
      },
      {
        label: "duplicate Transfer-Encoding",
        wire:
          "POST /oauth2/auth HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "Transfer-Encoding: chunked\r\n" +
          "Transfer-Encoding: chunked\r\n\r\n",
        code: "RFC9112_UNSUPPORTED_TE",
      },
      {
        label: "non-HTTP/1.1 request line",
        wire: "GET /oauth2/start HTTP/1.0\r\nHost: 127.0.0.1:4180\r\n\r\n",
        code: "RFC9112_INVALID_REQUEST_LINE",
      },
      {
        label: "extra spaces in request line",
        wire: "GET  /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\r\n",
        code: "RFC9112_INVALID_REQUEST_LINE",
      },
    ];

    for (const item of cases) {
      const state = makeState();
      feed(
        state,
        tcpPacket({ srcPort: 41030, dstPort: 4180, seq: 100, flags: TCP_SYN }),
      );
      feed(
        state,
        tcpPacket({
          srcPort: 41030,
          dstPort: 4180,
          seq: 101,
          flags: TCP_ACK,
          payload: item.wire,
        }),
      );
      const health = buildHealthSidecar(state);
      assert.equal(
        health.captureStats.integrityFaultCode,
        item.code,
        `case: ${item.label}`,
      );
      assert.ok(
        health.captureStats.parserErrors >= 1,
        `parserErrors for ${item.label}`,
      );
      const barrier = emitSentinelAndMatch(state, 1);
      assert.equal(
        barrier.matched,
        false,
        `barrier must withhold ack for ${item.label}`,
      );
      assert.equal(buildHealthSidecar(state).barrierSequence, 0);
    }

    // IPv4 fragment on TCP (MF bit set, even with tiny truncated L4 so ports cannot be read)
    const fragTcp = makeState();
    feed(
      fragTcp,
      ipv4Packet({
        proto: 6,
        flagsFrag: 0x2000,
        l4Payload: Buffer.from([0x10, 0x54]),
      }),
    );
    assert.equal(
      buildHealthSidecar(fragTcp).captureStats.integrityFaultCode,
      "IPV4_FRAGMENT_OBSERVED",
    );
    assert.equal(buildHealthSidecar(fragTcp).captureStats.ipv4Fragments, 1);
    assert.equal(emitSentinelAndMatch(fragTcp, 1).matched, false);

    // IPv4 fragment on UDP (non-zero fragment offset)
    const fragUdp = makeState();
    feed(
      fragUdp,
      ipv4Packet({
        proto: 17,
        flagsFrag: 0x0001,
        l4Payload: Buffer.from([0x01, 0x02]),
      }),
    );
    assert.equal(
      buildHealthSidecar(fragUdp).captureStats.integrityFaultCode,
      "IPV4_FRAGMENT_OBSERVED",
    );
    assert.equal(buildHealthSidecar(fragUdp).captureStats.ipv4Fragments, 1);

    // Accidental IPv6 TCP on port 4180 (Erratum 1: nextHeader at byte 6, TCP ports at 40/42) fails closed
    const ip6State = makeState();
    feed(ip6State, ipv6TcpPacket({ nextHeader: 6, dstPort: 4180 }), {
      ethProto: ETH_P_IPV6,
    });
    assert.notEqual(
      buildHealthSidecar(ip6State).captureStats.integrityFaultCode,
      null,
    );
    assert.equal(emitSentinelAndMatch(ip6State, 1).matched, false);
  });

  test("OBS-07: separates ephemeral port reuse via synEpoch, deduplicates SYN retransmit, and preserves cumulative drops", () => {
    const state = makeState();
    // First connection on srcPort 42000 with SYN retransmit (same ISN = 1000)
    feed(
      state,
      tcpPacket({ srcPort: 42000, dstPort: 4180, seq: 1000, flags: TCP_SYN }),
    );
    feed(
      state,
      tcpPacket({ srcPort: 42000, dstPort: 4180, seq: 1000, flags: TCP_SYN }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 42000,
        dstPort: 4180,
        seq: 1001,
        flags: TCP_ACK,
        payload:
          "GET /oauth2/start?a=1 HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "X-Forwarded-For: 172.31.51.11\r\n\r\n",
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 42000,
        dstPort: 4180,
        seq: 1089,
        flags: TCP_FIN | TCP_ACK,
      }),
    );

    // Immediate ephemeral port reuse on same 5-tuple with fresh SYN (ISN = 9000)
    feed(
      state,
      tcpPacket({ srcPort: 42000, dstPort: 4180, seq: 9000, flags: TCP_SYN }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 42000,
        dstPort: 4180,
        seq: 9001,
        flags: TCP_ACK,
        payload:
          "GET /oauth2/callback?code=2 HTTP/1.1\r\n" +
          "Host: 127.0.0.1:4180\r\n" +
          "X-Forwarded-For: 172.31.51.11\r\n\r\n",
      }),
    );

    const snap = buildV1Snapshot(state);
    assert.equal(snap.proxyRequests.length, 2);
    assert.equal(snap.proxyRequests[0].path, "/oauth2/start");
    assert.equal(snap.proxyRequests[1].path, "/oauth2/callback");

    // Cumulative drop tracking: a drop observed once must never be erased by a later lower/zero count
    recordStats(state, { kernelPackets: 20, kernelDrops: 2 });
    recordStats(state, { kernelPackets: 5, kernelDrops: 0 });
    const health = buildHealthSidecar(state);
    assert.equal(health.captureStats.kernelPackets, 20);
    assert.equal(health.captureStats.kernelDrops, 2);
    assert.equal(
      health.captureStats.integrityFaultCode,
      "KERNEL_DROP_OBSERVED",
    );
    assert.equal(emitSentinelAndMatch(state, 1).matched, false);
  });

  test("OBS-08: latches sticky faults on truncation, header cap, active flow cap, OOO cap, and event cap", () => {
    // MSG_TRUNC truncation
    const trunc = makeState();
    const pkt = udpPacket({ payload: "hello" });
    feed(trunc, pkt, { origLen: 131073 });
    assert.equal(
      buildHealthSidecar(trunc).captureStats.integrityFaultCode,
      "TRUNCATED_FRAME_OBSERVED",
    );
    assert.equal(buildHealthSidecar(trunc).captureStats.truncatedFrames, 1);

    // Header cap (> 24576 bytes)
    const hdr = makeState();
    feed(
      hdr,
      tcpPacket({ srcPort: 43001, dstPort: 4180, seq: 10, flags: TCP_SYN }),
    );
    feed(
      hdr,
      tcpPacket({
        srcPort: 43001,
        dstPort: 4180,
        seq: 11,
        flags: TCP_ACK,
        payload: `GET /oauth2/start HTTP/1.1\r\nX-Big: ${"x".repeat(25000)}\r\n\r\n`,
      }),
    );
    assert.equal(
      buildHealthSidecar(hdr).captureStats.integrityFaultCode,
      "HEADER_LIMIT_EXCEEDED",
    );

    // Active flow cap (> 256 active flows) vs > 256 sequential closed flows
    const seqClosed = makeState();
    for (let i = 0; i < 270; i++) {
      const p = 30000 + i;
      feed(
        seqClosed,
        tcpPacket({ srcPort: p, dstPort: 4180, seq: 100, flags: TCP_SYN }),
      );
      feed(
        seqClosed,
        tcpPacket({
          srcPort: p,
          dstPort: 4180,
          seq: 101,
          flags: TCP_FIN | TCP_ACK,
        }),
      );
    }
    assert.equal(
      buildHealthSidecar(seqClosed).captureStats.integrityFaultCode,
      null,
    );

    const activeOverflow = makeState();
    for (let i = 0; i < 257; i++) {
      feed(
        activeOverflow,
        tcpPacket({
          srcPort: 31000 + i,
          dstPort: 4180,
          seq: 100,
          flags: TCP_SYN,
        }),
      );
    }
    assert.equal(
      buildHealthSidecar(activeOverflow).captureStats.integrityFaultCode,
      "BUFFER_OVERFLOW",
    );
    assert.equal(
      buildHealthSidecar(activeOverflow).captureStats.bufferOverflows,
      1,
    );

    // OOO segment cap (> 8 segments)
    const oooOverflow = makeState();
    feed(
      oooOverflow,
      tcpPacket({ srcPort: 43002, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    for (let i = 0; i < 9; i++) {
      feed(
        oooOverflow,
        tcpPacket({
          srcPort: 43002,
          dstPort: 4180,
          seq: 200 + i * 10,
          flags: TCP_ACK,
          payload: "0123456789",
        }),
      );
    }
    assert.equal(
      buildHealthSidecar(oooOverflow).captureStats.integrityFaultCode,
      "BUFFER_OVERFLOW",
    );

    // OOO byte cap (> 32 KiB with fewer than 8 segments)
    const oooBytesOverflow = makeState();
    feed(
      oooBytesOverflow,
      tcpPacket({ srcPort: 43004, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    for (let i = 0; i < 4; i++) {
      feed(
        oooBytesOverflow,
        tcpPacket({
          srcPort: 43004,
          dstPort: 4180,
          seq: 200 + i * 9000,
          flags: TCP_ACK,
          payload: Buffer.alloc(9000, 0x41),
        }),
      );
    }
    assert.equal(
      buildHealthSidecar(oooBytesOverflow).captureStats.integrityFaultCode,
      "BUFFER_OVERFLOW",
    );

    // IPv4 options (IHL > 5) with trailing Ethernet padding parses cleanly
    const ipv4OptsState = makeState();
    const synWithOpts = Buffer.concat([
      tcpPacket({
        srcPort: 43005,
        dstPort: 4180,
        seq: 500,
        flags: TCP_SYN,
        optionsBytes: 8,
      }),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    const reqWithOpts = Buffer.concat([
      tcpPacket({
        srcPort: 43005,
        dstPort: 4180,
        seq: 501,
        flags: TCP_ACK,
        optionsBytes: 8,
        payload:
          "GET /oauth2/sign_out HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\r\n",
      }),
      Buffer.from([0x00, 0x00]),
    ]);
    feed(ipv4OptsState, synWithOpts);
    feed(ipv4OptsState, reqWithOpts);
    assert.equal(
      buildHealthSidecar(ipv4OptsState).captureStats.integrityFaultCode,
      null,
    );
    assert.equal(buildV1Snapshot(ipv4OptsState).proxyRequests.length, 1);

    // Proxy event cap (> maxEvents, tested with explicit limit override)
    const eventOverflow = makeState({ maxEvents: 2 });
    feed(
      eventOverflow,
      tcpPacket({ srcPort: 43003, dstPort: 4180, seq: 10, flags: TCP_SYN }),
    );
    const oneReq =
      "GET /oauth2/sign_out HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\r\n";
    feed(
      eventOverflow,
      tcpPacket({
        srcPort: 43003,
        dstPort: 4180,
        seq: 11,
        flags: TCP_ACK,
        payload: oneReq + oneReq + oneReq,
      }),
    );
    assert.equal(
      buildHealthSidecar(eventOverflow).captureStats.integrityFaultCode,
      "BUFFER_OVERFLOW",
    );
  });

  test("OBS-09: distinguishes warmed reuse from parked zero-request reuse marked in matchBarrier (Erratum 2)", () => {
    const state = makeState();

    // Startup self-test barrierSequence = 0
    const selfTest = emitSentinelAndMatch(state, 0);
    assert.equal(selfTest.matched, true);
    assert.equal(buildHealthSidecar(state).startupSelfTestPassed, true);
    assert.equal(buildV1Snapshot(state).proxyRequests.length, 0);

    // Connection 1 (port 44001): warmed keep-alive reuse (two requests without being parked at 0 requests)
    completeOriginHandshake(state, 44001, 1000, 5000);
    const originReq = "GET / HTTP/1.1\r\nHost: 127.0.0.1:18790\r\n\r\n";
    feed(
      state,
      tcpPacket({
        srcPort: 44001,
        dstPort: 18790,
        seq: 1001,
        ack: 5001,
        flags: TCP_ACK,
        payload: originReq,
      }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 44001,
        dstPort: 18790,
        seq: 1001 + originReq.length,
        ack: 5001,
        flags: TCP_ACK,
        payload: originReq,
      }),
    );
    assert.equal(emitSentinelAndMatch(state, 1).matched, true);

    let health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.handshakesCompleted, 1);
    assert.equal(health.originTcpSummary.reusedConnections, 1);
    assert.equal(health.originTcpSummary.zeroPriorRequestParkedConnections, 0);
    assert.equal(health.originTcpSummary.zeroPriorRequestReusedConnections, 0);
    assert.equal(health.originTcpSummary.unusedDialObserved, false);

    // Connection 2 (port 44002): completes handshake with 0 requests, then barrier marks parkedZeroRequest (Erratum 2)
    completeOriginHandshake(state, 44002, 2000, 6000);
    assert.equal(emitSentinelAndMatch(state, 2).matched, true);

    health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.handshakesCompleted, 2);
    assert.equal(health.originTcpSummary.zeroPriorRequestParkedConnections, 1);
    assert.equal(health.originTcpSummary.zeroPriorRequestReusedConnections, 0);
    assert.equal(health.originTcpSummary.unusedDialObserved, false);

    // Next GET / arrives on exact parked (5-tuple, synEpoch)
    feed(
      state,
      tcpPacket({
        srcPort: 44002,
        dstPort: 18790,
        seq: 2001,
        ack: 6001,
        flags: TCP_ACK,
        payload: originReq,
      }),
    );
    assert.equal(emitSentinelAndMatch(state, 3).matched, true);

    health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.reusedConnections, 1);
    assert.equal(health.originTcpSummary.zeroPriorRequestParkedConnections, 1);
    assert.equal(health.originTcpSummary.zeroPriorRequestReusedConnections, 1);
    assert.equal(health.originTcpSummary.unusedDialObserved, true);

    // A second request on that same connection counts as warmed reuse without double-counting zeroPriorRequestReusedConnections
    feed(
      state,
      tcpPacket({
        srcPort: 44002,
        dstPort: 18790,
        seq: 2001 + originReq.length,
        ack: 6001,
        flags: TCP_ACK,
        payload: originReq,
      }),
    );
    health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.reusedConnections, 2);
    assert.equal(health.originTcpSummary.zeroPriorRequestReusedConnections, 1);

    // Parked zero-request connection that closes with 0 bytes never flips unusedDialObserved
    const closedParked = makeState();
    completeOriginHandshake(closedParked, 44004, 4000, 8000);
    assert.equal(emitSentinelAndMatch(closedParked, 1).matched, true);
    feed(
      closedParked,
      tcpPacket({
        srcPort: 44004,
        dstPort: 18790,
        seq: 4001,
        ack: 8001,
        flags: TCP_FIN | TCP_ACK,
      }),
    );
    const closedParkedHealth = buildHealthSidecar(closedParked);
    assert.equal(
      closedParkedHealth.originTcpSummary.zeroPriorRequestParkedConnections,
      1,
    );
    assert.equal(
      closedParkedHealth.originTcpSummary.zeroByteClosedConnections,
      1,
    );
    assert.equal(
      closedParkedHealth.originTcpSummary.zeroPriorRequestReusedConnections,
      0,
    );
    assert.equal(closedParkedHealth.originTcpSummary.unusedDialObserved, false);

    // Connection 3 (port 44003): aborted dial before handshake completes (SYN -> RST)
    feed(
      state,
      tcpPacket({ srcPort: 44003, dstPort: 18790, seq: 3000, flags: TCP_SYN }),
    );
    feed(
      state,
      tcpPacket({ srcPort: 44003, dstPort: 18790, seq: 3001, flags: TCP_RST }),
    );
    health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.abortedBeforeHeadersConnections, 1);
    assert.equal(health.originTcpSummary.rstClosedConnections, 1);

    // UDP sentinels never enter proxyRequests
    assert.equal(buildV1Snapshot(state).proxyRequests.length, 0);
  });

  test("UDP sentinel ignores non-loopback sources or mismatched ports", () => {
    const state = makeState();
    const payload = `GWRK051:${PROVENANCE.runId}:0:0123456789abcdef`;
    feed(
      state,
      udpPacket({
        srcIp: "172.31.51.11",
        dstIp: "127.0.0.1",
        dstPort: SENTINEL_PORT,
        payload,
      }),
    );
    feed(
      state,
      udpPacket({
        srcIp: "127.0.0.1",
        dstIp: "127.0.0.1",
        dstPort: SENTINEL_PORT + 1,
        payload,
      }),
    );
    assert.equal(
      matchBarrier(state, { barrierSequence: 0, expectedPayload: payload })
        .matched,
      false,
    );
    assert.equal(buildHealthSidecar(state).startupSelfTestPassed, false);
  });

  test("REVIEW-REG-03: deduplicates retransmitted client SYN during SYN_ACK_SEEN on port 18790", () => {
    const state = makeState();
    const srcPort = 44100;
    const clientIsn = 1000;
    const serverIsn = 5000;

    feed(
      state,
      tcpPacket({ srcPort, dstPort: 18790, seq: clientIsn, flags: TCP_SYN }),
    );
    feed(
      state,
      tcpPacket({
        srcPort: 18790,
        dstPort: srcPort,
        seq: serverIsn,
        ack: (clientIsn + 1) >>> 0,
        flags: TCP_SYN | TCP_ACK,
      }),
    );
    // Retransmitted client SYN with identical ISN arriving after SYN+ACK
    feed(
      state,
      tcpPacket({ srcPort, dstPort: 18790, seq: clientIsn, flags: TCP_SYN }),
    );
    // Client completing ACK finishes 3-way handshake
    feed(
      state,
      tcpPacket({
        srcPort,
        dstPort: 18790,
        seq: (clientIsn + 1) >>> 0,
        ack: (serverIsn + 1) >>> 0,
        flags: TCP_ACK,
      }),
    );

    assert.equal(emitSentinelAndMatch(state, 1).matched, true);
    const health = buildHealthSidecar(state);
    assert.equal(health.originTcpSummary.handshakesCompleted, 1);
    assert.equal(health.originTcpSummary.zeroPriorRequestParkedConnections, 1);
  });

  test("REVIEW-REG-04: latches MID_HEADER_CLOSE on port 4180 when RST drops queued OOO bytes or fresh SYN evicts partial header", () => {
    // Case A: RST arrives while out-of-order request bytes sit in oooQueue (http.phase still IDLE)
    const oooRst = makeState();
    feed(
      oooRst,
      tcpPacket({ srcPort: 44101, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    feed(
      oooRst,
      tcpPacket({
        srcPort: 44101,
        dstPort: 4180,
        seq: 120,
        flags: TCP_ACK,
        payload: "Host: 127.0.0.1:4180\r\n\r\n",
      }),
    );
    feed(
      oooRst,
      tcpPacket({ srcPort: 44101, dstPort: 4180, seq: 101, flags: TCP_RST }),
    );
    assert.equal(
      buildHealthSidecar(oooRst).captureStats.integrityFaultCode,
      "MID_HEADER_CLOSE",
    );
    assert.equal(emitSentinelAndMatch(oooRst, 1).matched, false);

    // Case B: Fresh SYN on same 5-tuple evicts an open port 4180 flow mid-header
    const synEvict = makeState();
    feed(
      synEvict,
      tcpPacket({ srcPort: 44102, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    feed(
      synEvict,
      tcpPacket({
        srcPort: 44102,
        dstPort: 4180,
        seq: 101,
        flags: TCP_ACK,
        payload: "GET /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n",
      }),
    );
    feed(
      synEvict,
      tcpPacket({ srcPort: 44102, dstPort: 4180, seq: 9000, flags: TCP_SYN }),
    );
    assert.equal(
      buildHealthSidecar(synEvict).captureStats.integrityFaultCode,
      "MID_HEADER_CLOSE",
    );
    assert.equal(emitSentinelAndMatch(synEvict, 1).matched, false);
  });

  test("controls distinguish fresh-ISN SYN during SYN_ACK_SEEN, valid 0-byte or idle close, and queued OOO close", () => {
    // Different-ISN fresh SYN during SYN_ACK_SEEN aborts prior origin handshake and starts a new epoch
    const freshSyn = makeState();
    const srcPort = 44110;
    feed(
      freshSyn,
      tcpPacket({ srcPort, dstPort: 18790, seq: 1000, flags: TCP_SYN }),
    );
    feed(
      freshSyn,
      tcpPacket({
        srcPort: 18790,
        dstPort: srcPort,
        seq: 5000,
        ack: 1001,
        flags: TCP_SYN | TCP_ACK,
      }),
    );
    feed(
      freshSyn,
      tcpPacket({ srcPort, dstPort: 18790, seq: 7000, flags: TCP_SYN }),
    );
    feed(
      freshSyn,
      tcpPacket({
        srcPort: 18790,
        dstPort: srcPort,
        seq: 9000,
        ack: 7001,
        flags: TCP_SYN | TCP_ACK,
      }),
    );
    feed(
      freshSyn,
      tcpPacket({
        srcPort,
        dstPort: 18790,
        seq: 7001,
        ack: 9001,
        flags: TCP_ACK,
      }),
    );
    assert.equal(emitSentinelAndMatch(freshSyn, 1).matched, true);
    const freshSynHealth = buildHealthSidecar(freshSyn);
    assert.equal(
      freshSynHealth.originTcpSummary.abortedBeforeHeadersConnections,
      1,
    );
    assert.equal(freshSynHealth.originTcpSummary.handshakesCompleted, 1);
    assert.equal(
      freshSynHealth.originTcpSummary.zeroPriorRequestParkedConnections,
      1,
    );

    // Valid 0-byte RST and fresh-SYN eviction after completed idle proxy request do NOT latch MID_HEADER_CLOSE
    const validClose = makeState();
    feed(
      validClose,
      tcpPacket({ srcPort: 44111, dstPort: 4180, seq: 100, flags: TCP_SYN }),
    );
    feed(
      validClose,
      tcpPacket({ srcPort: 44111, dstPort: 4180, seq: 101, flags: TCP_RST }),
    );
    feed(
      validClose,
      tcpPacket({ srcPort: 44112, dstPort: 4180, seq: 200, flags: TCP_SYN }),
    );
    feed(
      validClose,
      tcpPacket({
        srcPort: 44112,
        dstPort: 4180,
        seq: 201,
        flags: TCP_ACK,
        payload: "GET /oauth2/start HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\r\n",
      }),
    );
    // Fresh SYN on same tuple while prior request is cleanly IDLE
    feed(
      validClose,
      tcpPacket({ srcPort: 44112, dstPort: 4180, seq: 8000, flags: TCP_SYN }),
    );
    feed(
      validClose,
      tcpPacket({
        srcPort: 44112,
        dstPort: 4180,
        seq: 8001,
        flags: TCP_ACK,
        payload:
          "GET /oauth2/sign_out HTTP/1.1\r\nHost: 127.0.0.1:4180\r\n\r\n",
      }),
    );
    assert.equal(emitSentinelAndMatch(validClose, 1).matched, true);
    assert.equal(
      buildHealthSidecar(validClose).captureStats.integrityFaultCode,
      null,
    );
    assert.equal(buildV1Snapshot(validClose).proxyRequests.length, 2);

    // Fresh SYN evicting port 4180 flow with queued OOO bytes latches MID_HEADER_CLOSE
    const oooSynEvict = makeState();
    feed(
      oooSynEvict,
      tcpPacket({ srcPort: 44113, dstPort: 4180, seq: 300, flags: TCP_SYN }),
    );
    feed(
      oooSynEvict,
      tcpPacket({
        srcPort: 44113,
        dstPort: 4180,
        seq: 320,
        flags: TCP_ACK,
        payload: "Host: 127.0.0.1:4180\r\n\r\n",
      }),
    );
    feed(
      oooSynEvict,
      tcpPacket({ srcPort: 44113, dstPort: 4180, seq: 9500, flags: TCP_SYN }),
    );
    assert.equal(
      buildHealthSidecar(oooSynEvict).captureStats.integrityFaultCode,
      "MID_HEADER_CLOSE",
    );

    // Origin flow with queued OOO bytes on RST counts as abortedBeforeHeaders, not zeroByteClosed
    const originOooRst = makeState();
    completeOriginHandshake(originOooRst, 44114, 400, 800);
    feed(
      originOooRst,
      tcpPacket({
        srcPort: 44114,
        dstPort: 18790,
        seq: 420,
        ack: 801,
        flags: TCP_ACK,
        payload: "Host: 127.0.0.1:18790\r\n\r\n",
      }),
    );
    feed(
      originOooRst,
      tcpPacket({
        srcPort: 44114,
        dstPort: 18790,
        seq: 401,
        ack: 801,
        flags: TCP_RST,
      }),
    );
    const originOooHealth = buildHealthSidecar(originOooRst);
    assert.equal(originOooHealth.originTcpSummary.zeroByteClosedConnections, 0);
    assert.equal(
      originOooHealth.originTcpSummary.abortedBeforeHeadersConnections,
      1,
    );
    assert.equal(originOooHealth.originTcpSummary.rstClosedConnections, 1);
  });
});
