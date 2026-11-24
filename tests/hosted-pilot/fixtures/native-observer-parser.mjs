import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PACKET_OUTGOING = 4;
const ETH_P_IP = 0x0800;
const ETH_P_IPV6 = 0x86dd;

const IP_PROTO_TCP = 6;
const IP_PROTO_UDP = 17;

const TCP_FIN = 0x01;
const TCP_SYN = 0x02;
const TCP_RST = 0x04;
const TCP_ACK = 0x10;

const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST"]);
const ALLOWED_PROXY_PATHS = new Set([
  "/oauth2/start",
  "/oauth2/callback",
  "/oauth2/auth",
  "/oauth2/sign_out",
]);

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VISIBLE_ASCII_RE = /^[\x21-\x7e]+$/;
const DIGITS_RE = /^[0-9]+$/;
const HEX_RE = /^[0-9A-Fa-f]+$/;
const RUN_ID_RE = /^[a-f0-9]{24}$/;
const IMAGE_ID_RE = /^sha256:[a-f0-9]{64}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export const INTEGRITY_FAULT_CODES = Object.freeze([
  "KERNEL_DROP_OBSERVED",
  "TRUNCATED_FRAME_OBSERVED",
  "IPV4_FRAGMENT_OBSERVED",
  "RFC9112_BARE_LF",
  "RFC9112_OBS_FOLD",
  "RFC9112_INVALID_HEADER_NAME",
  "RFC9112_CL_TE_CONFLICT",
  "RFC9112_INVALID_CONTENT_LENGTH",
  "RFC9112_UNSUPPORTED_TE",
  "RFC9112_INVALID_REQUEST_LINE",
  "MID_HEADER_CLOSE",
  "HEADER_LIMIT_EXCEEDED",
  "BODY_LIMIT_EXCEEDED",
  "BUFFER_OVERFLOW",
  "BARRIER_TIMEOUT",
]);

const INTEGRITY_FAULT_SET = new Set(INTEGRITY_FAULT_CODES);

export const DEFAULT_OBSERVER_LIMITS = Object.freeze({
  maxFlows: 256,
  maxOooSegmentsPerFlow: 8,
  maxOooBytesPerFlow: 32768,
  maxHeaderBytes: 24576,
  maxBodyBytes: 1048576,
  maxEvents: 4096,
  maxFrameBytes: 131072,
  minRcvBufBytes: 524288,
  maxSentinels: 32,
  maxChunkLineBytes: 1024,
  proxyPort: 4180,
  originPort: 18790,
});

function u32(value) {
  return value >>> 0;
}

function seqDiff(a, b) {
  return (a - b) | 0;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function trimOws(value) {
  let start = 0;
  let end = value.length;
  while (
    start < end &&
    (value.charCodeAt(start) === 0x20 || value.charCodeAt(start) === 0x09)
  ) {
    start++;
  }
  while (
    end > start &&
    (value.charCodeAt(end - 1) === 0x20 || value.charCodeAt(end - 1) === 0x09)
  ) {
    end--;
  }
  return value.slice(start, end);
}

function isValidIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return false;
    const num = Number.parseInt(part, 10);
    if (num < 0 || num > 255) return false;
  }
  return true;
}

function formatIpv4(buf, offset) {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

function validateProvenance(provenance) {
  assert.ok(
    provenance && typeof provenance === "object" && !Array.isArray(provenance),
    "observer provenance is required",
  );
  assert.match(provenance.runId ?? "", RUN_ID_RE, "invalid provenance runId");
  assert.match(
    provenance.proxyImageId ?? "",
    IMAGE_ID_RE,
    "invalid provenance proxyImageId",
  );
  assert.match(
    provenance.traefikImageId ?? "",
    IMAGE_ID_RE,
    "invalid provenance traefikImageId",
  );
  assert.match(
    provenance.runtimeReceiptSha256 ?? "",
    SHA256_RE,
    "invalid provenance runtimeReceiptSha256",
  );
  return {
    runId: provenance.runId,
    proxyImageId: provenance.proxyImageId,
    traefikImageId: provenance.traefikImageId,
    runtimeReceiptSha256: provenance.runtimeReceiptSha256,
    source: "passive_tcp",
    namespace: "owned_nested",
  };
}

function normalizeLimits(limits) {
  const merged = { ...DEFAULT_OBSERVER_LIMITS, ...(limits ?? {}) };
  for (const key of Object.keys(DEFAULT_OBSERVER_LIMITS)) {
    const val = merged[key];
    assert.ok(
      Number.isSafeInteger(val) && val > 0,
      `invalid observer limit ${key}`,
    );
  }
  return Object.freeze(merged);
}

function latchFault(state, code, counterField = null) {
  assert.ok(INTEGRITY_FAULT_SET.has(code), `unknown fault code: ${code}`);
  if (counterField) {
    state.captureStats[counterField] += 1;
  }
  if (state.captureStats.integrityFaultCode === null) {
    state.captureStats.integrityFaultCode = code;
  }
}

function clearFlowMemory(flow) {
  flow.oooQueue.length = 0;
  flow.oooBytes = 0;
  flow.http.headerBuf = Buffer.alloc(0);
  flow.http.lineBuf = Buffer.alloc(0);
  flow.http.trailerBytes = 0;
}

function createFlow(
  tupleKey,
  { srcIp, srcPort, dstIp, dstPort, synEpoch, synSeq },
) {
  return {
    tupleKey,
    srcIp,
    srcPort,
    dstIp,
    dstPort,
    synEpoch,
    clientIsn: u32(synSeq),
    serverIsn: null,
    handshakeState: "SYN_SENT",
    nextSeq: u32(synSeq + 1),
    finSeq: null,
    oooQueue: [],
    oooBytes: 0,
    totalClientPayloadBytes: 0,
    requestsOnConn: 0,
    parkedZeroRequest: false,
    countedAsZeroPriorRequestReused: false,
    countedAsReused: false,
    rstCounted: false,
    closed: false,
    http: {
      phase: "IDLE",
      headerBuf: Buffer.alloc(0),
      bodyRemaining: 0,
      bodySkipped: 0,
      lineBuf: Buffer.alloc(0),
      crlfNeed: 0,
      crlfFirstByte: -1,
      trailerBytes: 0,
    },
  };
}

export function createObserverState({ provenance, sentinelPort, limits } = {}) {
  const normalizedProvenance = validateProvenance(provenance);
  assert.ok(
    Number.isSafeInteger(sentinelPort) &&
      sentinelPort >= 1024 &&
      sentinelPort <= 65535,
    "sentinelPort must be an integer in 1024..65535",
  );
  const normalizedLimits = normalizeLimits(limits);

  return {
    provenance: normalizedProvenance,
    sentinelPort,
    limits: normalizedLimits,
    sequence: 0,
    barrierSequence: 0,
    startupSelfTestPassed: false,
    proxyRequests: [],
    observedSentinels: [],
    synEpochs: new Map(),
    activeFlows: new Map(),
    captureStats: {
      kernelPackets: 0,
      kernelDrops: 0,
      truncatedFrames: 0,
      parserErrors: 0,
      bufferOverflows: 0,
      ipv4Fragments: 0,
      effectiveRcvBufBytes: 0,
      ignoreOutgoingKernelEnabled: false,
      pkttypeBpfFallbackActive: false,
      integrityFaultCode: null,
    },
    originTcpSummary: {
      port: normalizedLimits.originPort,
      handshakesCompleted: 0,
      reusedConnections: 0,
      zeroPriorRequestParkedConnections: 0,
      zeroPriorRequestReusedConnections: 0,
      zeroByteClosedConnections: 0,
      rstClosedConnections: 0,
      abortedBeforeHeadersConnections: 0,
      synGateActive: false,
      unusedDialObserved: false,
    },
  };
}

function parseContentLength(values, maxBodyBytes) {
  let parsedValue = null;
  for (const raw of values) {
    const parts = raw.split(",");
    for (const part of parts) {
      const token = trimOws(part);
      if (!DIGITS_RE.test(token)) {
        return { error: "RFC9112_INVALID_CONTENT_LENGTH" };
      }
      const num = Number(token);
      if (!Number.isSafeInteger(num) || num < 0) {
        return { error: "RFC9112_INVALID_CONTENT_LENGTH" };
      }
      if (parsedValue !== null && parsedValue !== num) {
        return { error: "RFC9112_INVALID_CONTENT_LENGTH" };
      }
      parsedValue = num;
    }
  }
  if (parsedValue === null) {
    return { error: "RFC9112_INVALID_CONTENT_LENGTH" };
  }
  if (parsedValue > maxBodyBytes) {
    return { error: "BODY_LIMIT_EXCEEDED" };
  }
  return { value: parsedValue };
}

function parseHeaderBlock(state, flow, headerBytes) {
  const isProxy = flow.dstPort === state.limits.proxyPort;
  const text = headerBytes.toString("latin1");
  const lines = text.split("\r\n");
  if (lines.length === 0 || lines[0].length === 0) {
    latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
    return null;
  }

  // Request line: METHOD SP REQUEST-TARGET SP HTTP/1.1
  const requestLine = lines[0];
  const reqParts = requestLine.split(" ");
  if (reqParts.length !== 3) {
    latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
    return null;
  }
  const [rawMethod, rawTarget, rawVersion] = reqParts;
  if (
    !TOKEN_RE.test(rawMethod) ||
    !VISIBLE_ASCII_RE.test(rawTarget) ||
    rawVersion !== "HTTP/1.1"
  ) {
    latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
    return null;
  }

  const contentLengthValues = [];
  const transferEncodingValues = [];
  const cookieValues = [];
  let forwardedForCount = 0;
  let firstForwardedFor = "";
  let hasForwardedUri = false;
  let hasForwardedMethod = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    const firstChar = line.charCodeAt(0);
    if (firstChar === 0x20 || firstChar === 0x09) {
      latchFault(state, "RFC9112_OBS_FOLD", "parserErrors");
      return null;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      latchFault(state, "RFC9112_INVALID_HEADER_NAME", "parserErrors");
      return null;
    }
    const rawName = line.slice(0, colon);
    if (!TOKEN_RE.test(rawName)) {
      latchFault(state, "RFC9112_INVALID_HEADER_NAME", "parserErrors");
      return null;
    }
    const rawValue = line.slice(colon + 1);
    if (
      rawValue.includes("\r") ||
      rawValue.includes("\n") ||
      rawValue.includes("\0")
    ) {
      latchFault(state, "RFC9112_INVALID_HEADER_NAME", "parserErrors");
      return null;
    }
    const name = rawName.toLowerCase();
    const value = trimOws(rawValue);

    if (name === "content-length") {
      contentLengthValues.push(value);
    } else if (name === "transfer-encoding") {
      transferEncodingValues.push(value);
    } else if (isProxy) {
      if (name === "cookie") {
        cookieValues.push(value);
      } else if (name === "x-forwarded-for") {
        forwardedForCount += 1;
        if (forwardedForCount === 1) {
          firstForwardedFor = value;
        }
      } else if (name === "x-forwarded-uri") {
        hasForwardedUri = true;
      } else if (name === "x-forwarded-method") {
        hasForwardedMethod = true;
      }
    }
  }

  if (contentLengthValues.length > 0 && transferEncodingValues.length > 0) {
    latchFault(state, "RFC9112_CL_TE_CONFLICT", "parserErrors");
    return null;
  }

  let bodyFraming = { type: "none", remaining: 0 };
  if (transferEncodingValues.length > 0) {
    if (
      transferEncodingValues.length > 1 ||
      transferEncodingValues[0].toLowerCase() !== "chunked"
    ) {
      latchFault(state, "RFC9112_UNSUPPORTED_TE", "parserErrors");
      return null;
    }
    bodyFraming = { type: "chunked", remaining: 0 };
  } else if (contentLengthValues.length > 0) {
    const parsedCl = parseContentLength(
      contentLengthValues,
      state.limits.maxBodyBytes,
    );
    if (parsedCl.error) {
      latchFault(state, parsedCl.error, "parserErrors");
      return null;
    }
    bodyFraming = { type: "cl", remaining: parsedCl.value };
  }

  const qIdx = rawTarget.indexOf("?");
  const rawPath = qIdx === -1 ? rawTarget : rawTarget.slice(0, qIdx);
  const rawQuery = qIdx === -1 ? "" : rawTarget.slice(qIdx + 1);

  if (isProxy) {
    if (state.proxyRequests.length >= state.limits.maxEvents) {
      latchFault(state, "BUFFER_OVERFLOW", "bufferOverflows");
      return null;
    }
    let forwardedFor = "";
    if (forwardedForCount === 1) {
      forwardedFor = isValidIpv4(firstForwardedFor)
        ? firstForwardedFor
        : "INVALID";
    } else if (forwardedForCount > 1) {
      forwardedFor = "INVALID";
    }

    state.sequence += 1;
    state.proxyRequests.push({
      sequence: state.sequence,
      method: ALLOWED_PROXY_METHODS.has(rawMethod)
        ? rawMethod
        : "UNEXPECTED_METHOD",
      path: ALLOWED_PROXY_PATHS.has(rawPath) ? rawPath : "UNEXPECTED_PATH",
      querySha256: sha256Hex(rawQuery),
      cookieSha256: sha256Hex(cookieValues.join("; ")),
      peer: flow.srcIp,
      forwardedFor,
      forwardedForCount,
      hasForwardedUri,
      hasForwardedMethod,
    });
    flow.requestsOnConn += 1;
  } else {
    // Port 18790 origin flow
    flow.requestsOnConn += 1;
    if (
      flow.parkedZeroRequest &&
      !flow.countedAsZeroPriorRequestReused &&
      flow.requestsOnConn === 1 &&
      rawMethod === "GET" &&
      rawPath === "/"
    ) {
      flow.countedAsZeroPriorRequestReused = true;
      state.originTcpSummary.zeroPriorRequestReusedConnections += 1;
      state.originTcpSummary.unusedDialObserved = true;
    }
    if (flow.requestsOnConn === 2 && !flow.countedAsReused) {
      flow.countedAsReused = true;
      state.originTcpSummary.reusedConnections += 1;
    }
  }

  return bodyFraming;
}

function feedHttpStream(state, flow, chunk) {
  if (chunk.length === 0) return;
  flow.totalClientPayloadBytes += chunk.length;
  const http = flow.http;
  let offset = 0;

  while (offset < chunk.length) {
    if (state.captureStats.integrityFaultCode !== null) {
      clearFlowMemory(flow);
      return;
    }

    if (http.phase === "IDLE") {
      http.phase = "HEADERS";
      http.headerBuf = Buffer.alloc(0);
    }

    if (http.phase === "HEADERS") {
      const remaining = chunk.subarray(offset);
      const prevLen = http.headerBuf.length;
      const combined =
        prevLen === 0 ? remaining : Buffer.concat([http.headerBuf, remaining]);

      // Scan for bare LF and header block terminator CRLFCRLF without exceeding maxHeaderBytes
      let endIdx = -1;
      const scanStart = Math.max(0, prevLen - 3);
      for (let i = Math.max(0, prevLen); i < combined.length; i++) {
        if (combined[i] === 0x0a && (i === 0 || combined[i - 1] !== 0x0d)) {
          http.headerBuf = Buffer.alloc(0);
          latchFault(state, "RFC9112_BARE_LF", "parserErrors");
          return;
        }
        if (
          i >= 3 &&
          i >= scanStart + 3 &&
          combined[i - 3] === 0x0d &&
          combined[i - 2] === 0x0a &&
          combined[i - 1] === 0x0d &&
          combined[i] === 0x0a
        ) {
          endIdx = i + 1;
          break;
        }
      }

      if (endIdx === -1) {
        if (combined.length > state.limits.maxHeaderBytes) {
          http.headerBuf = Buffer.alloc(0);
          latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
          return;
        }
        http.headerBuf = Buffer.from(combined);
        offset = chunk.length;
        continue;
      }

      if (endIdx > state.limits.maxHeaderBytes) {
        http.headerBuf = Buffer.alloc(0);
        latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
        return;
      }

      const headerBlock = combined.subarray(0, endIdx - 4);
      const consumedFromRemaining = endIdx - prevLen;
      // Clear header buffer immediately so raw credentials are never retained
      http.headerBuf = Buffer.alloc(0);
      offset += consumedFromRemaining;

      const framing = parseHeaderBlock(state, flow, headerBlock);
      if (!framing) {
        clearFlowMemory(flow);
        return;
      }

      if (
        framing.type === "none" ||
        (framing.type === "cl" && framing.remaining === 0)
      ) {
        http.phase = "IDLE";
      } else if (framing.type === "cl") {
        http.phase = "BODY_CL";
        http.bodyRemaining = framing.remaining;
        http.bodySkipped = 0;
      } else {
        http.phase = "BODY_CHUNK_SIZE";
        http.bodyRemaining = 0;
        http.bodySkipped = 0;
        http.lineBuf = Buffer.alloc(0);
        http.trailerBytes = 0;
      }
      continue;
    }

    if (http.phase === "BODY_CL") {
      const take = Math.min(chunk.length - offset, http.bodyRemaining);
      http.bodyRemaining -= take;
      http.bodySkipped += take;
      offset += take;
      if (http.bodySkipped > state.limits.maxBodyBytes) {
        latchFault(state, "BODY_LIMIT_EXCEEDED", "parserErrors");
        clearFlowMemory(flow);
        return;
      }
      if (http.bodyRemaining === 0) {
        http.phase = "IDLE";
      }
      continue;
    }

    if (http.phase === "BODY_CHUNK_SIZE") {
      const remaining = chunk.subarray(offset);
      const prevLen = http.lineBuf.length;
      const combined =
        prevLen === 0 ? remaining : Buffer.concat([http.lineBuf, remaining]);
      const lfIdx = combined.indexOf(0x0a);
      if (lfIdx === -1) {
        if (combined.length > state.limits.maxChunkLineBytes) {
          http.lineBuf = Buffer.alloc(0);
          latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
          return;
        }
        http.lineBuf = Buffer.from(combined);
        offset = chunk.length;
        continue;
      }
      if (lfIdx === 0 || combined[lfIdx - 1] !== 0x0d) {
        http.lineBuf = Buffer.alloc(0);
        latchFault(state, "RFC9112_BARE_LF", "parserErrors");
        return;
      }
      if (lfIdx + 1 > state.limits.maxChunkLineBytes) {
        http.lineBuf = Buffer.alloc(0);
        latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
        return;
      }
      const lineStr = combined.subarray(0, lfIdx - 1).toString("latin1");
      http.lineBuf = Buffer.alloc(0);
      offset += lfIdx + 1 - prevLen;

      const semiIdx = lineStr.indexOf(";");
      const hexPart = semiIdx === -1 ? lineStr : lineStr.slice(0, semiIdx);
      if (!HEX_RE.test(hexPart)) {
        latchFault(state, "RFC9112_UNSUPPORTED_TE", "parserErrors");
        return;
      }
      const chunkSize = Number.parseInt(hexPart, 16);
      if (
        !Number.isSafeInteger(chunkSize) ||
        chunkSize < 0 ||
        http.bodySkipped + chunkSize > state.limits.maxBodyBytes
      ) {
        latchFault(state, "BODY_LIMIT_EXCEEDED", "parserErrors");
        return;
      }
      if (chunkSize === 0) {
        http.phase = "BODY_CHUNK_TRAILERS";
        http.lineBuf = Buffer.alloc(0);
      } else {
        http.phase = "BODY_CHUNK_DATA";
        http.bodyRemaining = chunkSize;
      }
      continue;
    }

    if (http.phase === "BODY_CHUNK_DATA") {
      const take = Math.min(chunk.length - offset, http.bodyRemaining);
      http.bodyRemaining -= take;
      http.bodySkipped += take;
      offset += take;
      if (http.bodyRemaining === 0) {
        http.phase = "BODY_CHUNK_DATA_CRLF";
        http.crlfNeed = 2;
        http.crlfFirstByte = -1;
      }
      continue;
    }

    if (http.phase === "BODY_CHUNK_DATA_CRLF") {
      const byte = chunk[offset++];
      if (http.crlfNeed === 2) {
        if (byte === 0x0a) {
          latchFault(state, "RFC9112_BARE_LF", "parserErrors");
          return;
        }
        if (byte !== 0x0d) {
          latchFault(state, "RFC9112_UNSUPPORTED_TE", "parserErrors");
          return;
        }
        http.crlfFirstByte = byte;
        http.crlfNeed = 1;
      } else {
        if (byte !== 0x0a) {
          latchFault(state, "RFC9112_UNSUPPORTED_TE", "parserErrors");
          return;
        }
        http.crlfNeed = 0;
        http.phase = "BODY_CHUNK_SIZE";
        http.lineBuf = Buffer.alloc(0);
      }
      continue;
    }

    if (http.phase === "BODY_CHUNK_TRAILERS") {
      const remaining = chunk.subarray(offset);
      const prevLen = http.lineBuf.length;
      const combined =
        prevLen === 0 ? remaining : Buffer.concat([http.lineBuf, remaining]);
      const lfIdx = combined.indexOf(0x0a);
      if (lfIdx === -1) {
        if (http.trailerBytes + combined.length > state.limits.maxHeaderBytes) {
          http.lineBuf = Buffer.alloc(0);
          latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
          return;
        }
        http.lineBuf = Buffer.from(combined);
        offset = chunk.length;
        continue;
      }
      if (lfIdx === 0 || combined[lfIdx - 1] !== 0x0d) {
        http.lineBuf = Buffer.alloc(0);
        latchFault(state, "RFC9112_BARE_LF", "parserErrors");
        return;
      }
      const lineLen = lfIdx + 1;
      http.trailerBytes += lineLen;
      if (http.trailerBytes > state.limits.maxHeaderBytes) {
        http.lineBuf = Buffer.alloc(0);
        latchFault(state, "HEADER_LIMIT_EXCEEDED", "parserErrors");
        return;
      }
      const isEmptyLine = lfIdx === 1;
      http.lineBuf = Buffer.alloc(0);
      offset += lineLen - prevLen;
      if (isEmptyLine) {
        http.phase = "IDLE";
        http.trailerBytes = 0;
      }
    }
  }
}

function drainOooQueue(state, flow) {
  while (flow.oooQueue.length > 0) {
    const seg = flow.oooQueue[0];
    const diff = seqDiff(seg.seq, flow.nextSeq);
    if (diff > 0) break;
    flow.oooQueue.shift();
    flow.oooBytes -= seg.data.length;
    if (diff === 0) {
      feedHttpStream(state, flow, seg.data);
      flow.nextSeq = u32(flow.nextSeq + seg.data.length);
    } else {
      const overlap = -diff;
      if (overlap < seg.data.length) {
        const fresh = seg.data.subarray(overlap);
        feedHttpStream(state, flow, fresh);
        flow.nextSeq = u32(flow.nextSeq + fresh.length);
      }
    }
    if (state.captureStats.integrityFaultCode !== null) return;
  }
}

function finalizeFlowClose(state, flow, isRst) {
  if (flow.closed) return;
  const isProxy = flow.dstPort === state.limits.proxyPort;
  const isOrigin = flow.dstPort === state.limits.originPort;

  if (isOrigin) {
    if (isRst && !flow.rstCounted) {
      flow.rstCounted = true;
      state.originTcpSummary.rstClosedConnections += 1;
    }
    if (flow.handshakeState !== "ESTABLISHED") {
      state.originTcpSummary.abortedBeforeHeadersConnections += 1;
    } else if (flow.totalClientPayloadBytes === 0) {
      state.originTcpSummary.zeroByteClosedConnections += 1;
    } else if (flow.http.phase !== "IDLE" && flow.requestsOnConn === 0) {
      state.originTcpSummary.abortedBeforeHeadersConnections += 1;
    }
  } else if (isProxy) {
    if (flow.http.phase !== "IDLE") {
      latchFault(state, "MID_HEADER_CLOSE", "parserErrors");
    }
  }

  flow.closed = true;
  clearFlowMemory(flow);
  state.activeFlows.delete(flow.tupleKey);
}

function handleTcpPacket(state, { srcIp, dstIp, l4 }) {
  if (l4.length < 20) return;
  const srcPort = l4.readUInt16BE(0);
  const dstPort = l4.readUInt16BE(2);
  const seq = l4.readUInt32BE(4);
  const ack = l4.readUInt32BE(8);
  const dataOffset = ((l4[12] >> 4) & 0x0f) * 4;
  if (dataOffset < 20 || dataOffset > l4.length) return;
  const flags = l4[13];
  const tcpPayload = l4.subarray(dataOffset);

  const proxyPort = state.limits.proxyPort;
  const originPort = state.limits.originPort;

  // Server -> Client traffic on monitored ports (used for 18790 3-way handshake and RST tracking)
  if (srcPort === originPort || srcPort === proxyPort) {
    const revTuple = `${dstIp}:${dstPort}->${srcIp}:${srcPort}`;
    const flow = state.activeFlows.get(revTuple);
    if (!flow) return;
    if ((flags & TCP_SYN) !== 0 && (flags & TCP_ACK) !== 0) {
      if (
        (flow.handshakeState === "SYN_SENT" ||
          flow.handshakeState === "SYN_ACK_SEEN") &&
        ack === u32(flow.clientIsn + 1)
      ) {
        flow.handshakeState = "SYN_ACK_SEEN";
        flow.serverIsn = u32(seq);
      }
      return;
    }
    if ((flags & TCP_RST) !== 0) {
      finalizeFlowClose(state, flow, true);
    }
    return;
  }

  // Client -> Server traffic on monitored ports
  if (dstPort !== proxyPort && dstPort !== originPort) return;

  const tupleKey = `${srcIp}:${srcPort}->${dstIp}:${dstPort}`;
  let flow = state.activeFlows.get(tupleKey);

  // Client SYN without ACK starts a new synEpoch (or deduplicates retransmitted SYN)
  if ((flags & TCP_SYN) !== 0 && (flags & TCP_ACK) === 0) {
    if (
      flow &&
      flow.handshakeState === "SYN_SENT" &&
      flow.clientIsn === u32(seq)
    ) {
      return;
    }
    if (flow) {
      clearFlowMemory(flow);
      flow.closed = true;
      state.activeFlows.delete(tupleKey);
    }
    if (state.activeFlows.size >= state.limits.maxFlows) {
      latchFault(state, "BUFFER_OVERFLOW", "bufferOverflows");
      return;
    }
    const nextEpoch = (state.synEpochs.get(tupleKey) ?? 0) + 1;
    if (state.synEpochs.size >= 4096 && !state.synEpochs.has(tupleKey)) {
      const oldestKey = state.synEpochs.keys().next().value;
      state.synEpochs.delete(oldestKey);
    }
    state.synEpochs.set(tupleKey, nextEpoch);
    flow = createFlow(tupleKey, {
      srcIp,
      srcPort,
      dstIp,
      dstPort,
      synEpoch: nextEpoch,
      synSeq: seq,
    });
    state.activeFlows.set(tupleKey, flow);
    return;
  }

  if (!flow) return;

  if ((flags & TCP_RST) !== 0) {
    finalizeFlowClose(state, flow, true);
    return;
  }

  // Transition handshake state
  if ((flags & TCP_ACK) !== 0) {
    if (dstPort === originPort) {
      if (
        flow.handshakeState === "SYN_ACK_SEEN" &&
        (flow.serverIsn === null || ack === u32(flow.serverIsn + 1))
      ) {
        flow.handshakeState = "ESTABLISHED";
        state.originTcpSummary.handshakesCompleted += 1;
      }
    } else if (dstPort === proxyPort && flow.handshakeState === "SYN_SENT") {
      // BPF does not capture proxy server->client responses (srcPort 4180), so client ACK establishes proxy flow
      flow.handshakeState = "ESTABLISHED";
    }
  }

  // Reassemble TCP stream payload
  if (tcpPayload.length > 0) {
    const diff = seqDiff(seq, flow.nextSeq);
    if (diff === 0) {
      feedHttpStream(state, flow, tcpPayload);
      flow.nextSeq = u32(flow.nextSeq + tcpPayload.length);
      if (state.captureStats.integrityFaultCode === null) {
        drainOooQueue(state, flow);
      }
    } else if (diff < 0) {
      const overlap = -diff;
      if (overlap < tcpPayload.length) {
        const fresh = tcpPayload.subarray(overlap);
        feedHttpStream(state, flow, fresh);
        flow.nextSeq = u32(flow.nextSeq + fresh.length);
        if (state.captureStats.integrityFaultCode === null) {
          drainOooQueue(state, flow);
        }
      }
    } else {
      const isDuplicate = flow.oooQueue.some(
        (seg) => seg.seq === u32(seq) && seg.data.length === tcpPayload.length,
      );
      if (!isDuplicate) {
        if (
          flow.oooQueue.length >= state.limits.maxOooSegmentsPerFlow ||
          flow.oooBytes + tcpPayload.length > state.limits.maxOooBytesPerFlow
        ) {
          clearFlowMemory(flow);
          latchFault(state, "BUFFER_OVERFLOW", "bufferOverflows");
          return;
        }
        flow.oooQueue.push({ seq: u32(seq), data: Buffer.from(tcpPayload) });
        flow.oooBytes += tcpPayload.length;
        flow.oooQueue.sort((a, b) => seqDiff(a.seq, b.seq));
      }
    }
  }

  // Handle FIN (which may arrive out of order before missing bytes)
  if ((flags & TCP_FIN) !== 0) {
    const finSeq = u32(seq + tcpPayload.length);
    if (flow.finSeq === null) {
      flow.finSeq = finSeq;
    }
  }
  if (flow.finSeq !== null && seqDiff(flow.finSeq, flow.nextSeq) <= 0) {
    if (seqDiff(flow.finSeq, flow.nextSeq) === 0) {
      flow.nextSeq = u32(flow.finSeq + 1);
    }
    finalizeFlowClose(state, flow, false);
  }
}

function handleUdpPacket(state, { srcIp, dstIp, l4 }) {
  if (l4.length < 8) return;
  const dstPort = l4.readUInt16BE(2);
  const udpLen = l4.readUInt16BE(4);
  if (udpLen < 8 || udpLen > l4.length) return;
  if (
    srcIp !== "127.0.0.1" ||
    dstIp !== "127.0.0.1" ||
    dstPort !== state.sentinelPort
  ) {
    return;
  }
  const body = l4.subarray(8, udpLen);
  if (body.length === 0 || body.length > 128) return;
  const text = body.toString("ascii");
  if (!VISIBLE_ASCII_RE.test(text)) return;
  if (!state.observedSentinels.includes(text)) {
    if (state.observedSentinels.length >= state.limits.maxSentinels) {
      state.observedSentinels.shift();
    }
    state.observedSentinels.push(text);
  }
}

export function ingestPacket(
  state,
  { pkttype = 0, ethProto, monotonicNs = 0n, origLen, payload },
) {
  void monotonicNs;
  // Defense-in-depth loopback outgoing dedup
  if (pkttype === PACKET_OUTGOING) {
    return state;
  }

  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
  const effectiveOrigLen = origLen ?? buf.length;
  if (
    !Number.isSafeInteger(effectiveOrigLen) ||
    effectiveOrigLen < 0 ||
    effectiveOrigLen > state.limits.maxFrameBytes ||
    effectiveOrigLen > buf.length
  ) {
    latchFault(state, "TRUNCATED_FRAME_OBSERVED", "truncatedFrames");
    return state;
  }

  if (ethProto === ETH_P_IPV6) {
    // Erratum 1: IPv6 nextHeader is at byte offset 6, TCP ports at 40 and 42
    if (buf.length >= 44 && buf[6] === IP_PROTO_TCP) {
      const srcPort = buf.readUInt16BE(40);
      const dstPort = buf.readUInt16BE(42);
      if (
        dstPort === state.limits.proxyPort ||
        srcPort === state.limits.originPort ||
        dstPort === state.limits.originPort
      ) {
        latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
      }
    }
    return state;
  }

  if (ethProto !== ETH_P_IP) {
    return state;
  }

  if (buf.length < 20) {
    latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
    return state;
  }
  const version = buf[0] >> 4;
  const ihl = (buf[0] & 0x0f) * 4;
  const totalLen = buf.readUInt16BE(2);
  if (
    version !== 4 ||
    ihl < 20 ||
    ihl > buf.length ||
    totalLen < ihl ||
    totalLen > buf.length
  ) {
    latchFault(state, "RFC9112_INVALID_REQUEST_LINE", "parserErrors");
    return state;
  }

  const proto = buf[9];
  const flagsFrag = buf.readUInt16BE(6);
  if (
    (proto === IP_PROTO_TCP || proto === IP_PROTO_UDP) &&
    (flagsFrag & 0x3fff) !== 0
  ) {
    latchFault(state, "IPV4_FRAGMENT_OBSERVED", "ipv4Fragments");
    return state;
  }

  const srcIp = formatIpv4(buf, 12);
  const dstIp = formatIpv4(buf, 16);
  const l4 = buf.subarray(ihl, totalLen);

  if (proto === IP_PROTO_UDP) {
    handleUdpPacket(state, { srcIp, dstIp, l4 });
  } else if (proto === IP_PROTO_TCP) {
    handleTcpPacket(state, { srcIp, dstIp, l4 });
  }

  return state;
}

export function recordStats(
  state,
  {
    kernelPackets,
    kernelDrops,
    effectiveRcvBufBytes,
    ignoreOutgoingKernelEnabled,
    pkttypeBpfFallbackActive,
    integrityFaultCode,
  } = {},
) {
  if (kernelPackets !== undefined) {
    const val = Number(kernelPackets);
    assert.ok(
      Number.isSafeInteger(val) && val >= 0,
      "kernelPackets must be a non-negative safe integer",
    );
    state.captureStats.kernelPackets = Math.max(
      state.captureStats.kernelPackets,
      val,
    );
  }
  if (kernelDrops !== undefined) {
    const val = Number(kernelDrops);
    assert.ok(
      Number.isSafeInteger(val) && val >= 0,
      "kernelDrops must be a non-negative safe integer",
    );
    state.captureStats.kernelDrops = Math.max(
      state.captureStats.kernelDrops,
      val,
    );
    if (state.captureStats.kernelDrops > 0) {
      latchFault(state, "KERNEL_DROP_OBSERVED");
    }
  }
  if (effectiveRcvBufBytes !== undefined) {
    assert.ok(
      Number.isSafeInteger(effectiveRcvBufBytes) && effectiveRcvBufBytes >= 0,
      "effectiveRcvBufBytes must be a non-negative safe integer",
    );
    state.captureStats.effectiveRcvBufBytes = effectiveRcvBufBytes;
  }
  if (ignoreOutgoingKernelEnabled !== undefined) {
    state.captureStats.ignoreOutgoingKernelEnabled = Boolean(
      ignoreOutgoingKernelEnabled,
    );
  }
  if (pkttypeBpfFallbackActive !== undefined) {
    state.captureStats.pkttypeBpfFallbackActive = Boolean(
      pkttypeBpfFallbackActive,
    );
  }
  if (integrityFaultCode !== undefined && integrityFaultCode !== null) {
    const counterField =
      integrityFaultCode === "TRUNCATED_FRAME_OBSERVED"
        ? "truncatedFrames"
        : null;
    latchFault(state, integrityFaultCode, counterField);
  }
  return state;
}

export function matchBarrier(state, { barrierSequence, expectedPayload }) {
  assert.ok(
    Number.isSafeInteger(barrierSequence) &&
      barrierSequence >= 0 &&
      barrierSequence <= 100_000,
    "invalid barrierSequence",
  );
  assert.ok(
    typeof expectedPayload === "string" && expectedPayload.length > 0,
    "expectedPayload must be a non-empty string",
  );

  if (state.captureStats.integrityFaultCode !== null) {
    return {
      matched: false,
      faultCode: state.captureStats.integrityFaultCode,
      barrierSequence: state.barrierSequence,
    };
  }

  const idx = state.observedSentinels.indexOf(expectedPayload);
  if (idx === -1) {
    return {
      matched: false,
      faultCode: null,
      barrierSequence: state.barrierSequence,
    };
  }

  state.observedSentinels.splice(idx, 1);

  if (barrierSequence === 0) {
    state.startupSelfTestPassed = true;
  } else if (barrierSequence > state.barrierSequence) {
    state.barrierSequence = barrierSequence;
  }

  // Review Erratum 2: mark ESTABLISHED port 18790 flows with zero requests as parkedZeroRequest during matchBarrier
  for (const flow of state.activeFlows.values()) {
    if (
      flow.dstPort === state.limits.originPort &&
      flow.handshakeState === "ESTABLISHED" &&
      flow.requestsOnConn === 0 &&
      flow.totalClientPayloadBytes === 0 &&
      !flow.closed &&
      !flow.parkedZeroRequest
    ) {
      flow.parkedZeroRequest = true;
      state.originTcpSummary.zeroPriorRequestParkedConnections += 1;
    }
  }

  return {
    matched: true,
    faultCode: null,
    barrierSequence: state.barrierSequence,
  };
}

export function buildV1Snapshot(state) {
  return {
    version: 1,
    provenance: { ...state.provenance },
    sequence: state.sequence,
    barrierSequence: state.barrierSequence,
    proxyRequests: state.proxyRequests.map((event) => ({ ...event })),
  };
}

export function buildHealthSidecar(state) {
  return {
    version: 1,
    provenance: { ...state.provenance },
    barrierSequence: state.barrierSequence,
    sentinelPort: state.sentinelPort,
    startupSelfTestPassed: state.startupSelfTestPassed,
    captureStats: { ...state.captureStats },
    originTcpSummary: {
      ...state.originTcpSummary,
      unusedDialObserved:
        state.originTcpSummary.zeroPriorRequestReusedConnections > 0,
    },
  };
}
