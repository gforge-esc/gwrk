import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import {
  CAPTURE_FRAME_KIND,
  createFrameDecoder,
  createNativeObserverSupervisor,
  verifyObserverDirectory,
} from "./native-observer.mjs";
import { validateNativeObservation } from "./raw-https.mjs";

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const CAPTURE_PY_PATH = join(FIXTURES_DIR, "native-observer-capture.py");

const PROVENANCE = {
  runId: "fedcba9876543210fedcba98",
  proxyImageId: `sha256:${"1".repeat(64)}`,
  traefikImageId: `sha256:${"2".repeat(64)}`,
  runtimeReceiptSha256: "3".repeat(64),
};

function packFrame({
  kind,
  pkttype = 0,
  ethProto = 0x0800,
  ifindex = 1,
  monotonicNs = 123456n,
  origLen,
  payload = Buffer.alloc(0),
}) {
  const header = Buffer.alloc(24);
  header.writeUInt8(kind, 0);
  header.writeUInt8(pkttype, 1);
  header.writeUInt16BE(ethProto, 2);
  header.writeUInt32BE(ifindex, 4);
  header.writeBigUInt64BE(monotonicNs, 8);
  header.writeUInt32BE(origLen ?? payload.length, 16);
  header.writeUInt32BE(payload.length, 20);
  return Buffer.concat([header, payload]);
}

function packReadyFrame({
  effectiveRcvBufBytes = 1048576,
  ignoreOutgoingKernelEnabled = true,
  pkttypeBpfFallbackActive = false,
} = {}) {
  const payload = Buffer.alloc(16);
  payload.writeUInt32BE(effectiveRcvBufBytes, 0);
  payload.writeUInt8(ignoreOutgoingKernelEnabled ? 1 : 0, 4);
  payload.writeUInt8(pkttypeBpfFallbackActive ? 1 : 0, 5);
  return packFrame({ kind: CAPTURE_FRAME_KIND.READY, payload });
}

function packStatsFrame(totalPackets, totalDrops) {
  const payload = Buffer.alloc(16);
  payload.writeBigUInt64BE(BigInt(totalPackets), 0);
  payload.writeBigUInt64BE(BigInt(totalDrops), 8);
  return packFrame({ kind: CAPTURE_FRAME_KIND.STATS_REPLY, payload });
}

function packFaultFrame(faultCodeId, osErrno = 0) {
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(faultCodeId, 0);
  payload.writeUInt32BE(osErrno, 4);
  return packFrame({ kind: CAPTURE_FRAME_KIND.FAULT, payload });
}

function buildIpv4Packet(proto, l4Payload) {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header.writeUInt16BE(20 + l4Payload.length, 2);
  header[8] = 64;
  header[9] = proto;
  header.set([127, 0, 0, 1], 12);
  header.set([127, 0, 0, 1], 16);
  return Buffer.concat([header, l4Payload]);
}

function buildUdpLoopback(dstPort, text) {
  const body = Buffer.from(text, "utf8");
  const udp = Buffer.alloc(8 + body.length);
  udp.writeUInt16BE(54321, 0);
  udp.writeUInt16BE(dstPort, 2);
  udp.writeUInt16BE(8 + body.length, 4);
  body.copy(udp, 8);
  return buildIpv4Packet(17, udp);
}

function buildTcpLoopback({ srcPort, dstPort, seq, flags, payload = "" }) {
  const body = Buffer.from(payload, "utf8");
  const tcp = Buffer.alloc(20 + body.length);
  tcp.writeUInt16BE(srcPort, 0);
  tcp.writeUInt16BE(dstPort, 2);
  tcp.writeUInt32BE(seq >>> 0, 4);
  tcp[12] = 0x50;
  tcp[13] = flags;
  tcp.writeUInt16BE(65535, 14);
  body.copy(tcp, 20);
  return buildIpv4Packet(6, tcp);
}

function createFakeHarness({
  sentinelPort = 49200,
  autoReady = true,
  effectiveRcvBufBytes = 1048576,
  statsProvider = () => ({ packets: 10, drops: 0 }),
  echoSentinel = true,
  respondToStats = true,
} = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const helper = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    killed: false,
    exitCode: null,
    kill(signal) {
      this.killed = true;
      this.exitCode = 0;
      queueMicrotask(() => this.emit("exit", 0, signal));
    },
  });

  const receivedCommands = [];
  stdin.on("data", (chunk) => {
    for (const byte of chunk) {
      receivedCommands.push(byte);
      if (byte === 0x53 && respondToStats) {
        const { packets, drops } = statsProvider();
        stdout.write(packStatsFrame(packets, drops));
      } else if (byte === 0x51) {
        helper.exitCode = 0;
        queueMicrotask(() => helper.emit("exit", 0, null));
      }
    }
  });

  const sentUdp = [];
  const udpSocket = {
    boundPort: null,
    closed: false,
    bind(_port, _host, cb) {
      this.boundPort = sentinelPort;
      queueMicrotask(() => cb?.());
    },
    address() {
      return { address: "127.0.0.1", port: this.boundPort };
    },
    send(msg, port, host, cb) {
      const text = Buffer.isBuffer(msg) ? msg.toString("utf8") : String(msg);
      sentUdp.push({ text, port, host });
      cb?.(null);
      if (echoSentinel) {
        const pkt = buildUdpLoopback(port, text);
        queueMicrotask(() => {
          stdout.write(
            packFrame({ kind: CAPTURE_FRAME_KIND.PACKET, payload: pkt }),
          );
        });
      }
    },
    on() {},
    close(cb) {
      this.closed = true;
      cb?.();
    },
  };

  if (autoReady) {
    queueMicrotask(() => {
      stdout.write(packReadyFrame({ effectiveRcvBufBytes }));
    });
  }

  return {
    helper,
    udpSocket,
    sentUdp,
    receivedCommands,
    emitPacket(payload, opts = {}) {
      stdout.write(
        packFrame({
          kind: CAPTURE_FRAME_KIND.PACKET,
          payload,
          origLen: opts.origLen ?? payload.length,
          pkttype: opts.pkttype ?? 0,
        }),
      );
    },
    emitFault(faultCodeId, osErrno = 0) {
      stdout.write(packFaultFrame(faultCodeId, osErrno));
    },
  };
}

function makeTempObserverDir() {
  const dir = mkdtempSync(join(tmpdir(), "gwrk-obs-test-"));
  chmodSync(dir, 0o700);
  return dir;
}

describe("native-observer binary framing and supervisor", () => {
  test("decodes 24-byte big-endian pipe frames across arbitrary splits and rejects oversized capLen", () => {
    const frames = [];
    const decoder = createFrameDecoder((frame) => frames.push(frame));
    const combined = Buffer.concat([
      packReadyFrame({
        effectiveRcvBufBytes: 524288,
        ignoreOutgoingKernelEnabled: false,
        pkttypeBpfFallbackActive: true,
      }),
      packFrame({
        kind: CAPTURE_FRAME_KIND.PACKET,
        payload: Buffer.from("abcd"),
      }),
      packStatsFrame(42, 0),
      packFaultFrame(1, 22),
    ]);

    // Feed 3 bytes at a time to stress header and payload boundary splitting
    for (let i = 0; i < combined.length; i += 3) {
      decoder.push(combined.subarray(i, i + 3));
    }

    assert.equal(frames.length, 4);
    assert.equal(frames[0].kind, CAPTURE_FRAME_KIND.READY);
    assert.equal(frames[0].effectiveRcvBufBytes, 524288);
    assert.equal(frames[0].ignoreOutgoingKernelEnabled, false);
    assert.equal(frames[0].pkttypeBpfFallbackActive, true);
    assert.equal(frames[1].kind, CAPTURE_FRAME_KIND.PACKET);
    assert.equal(frames[1].payload.toString("utf8"), "abcd");
    assert.equal(frames[2].kind, CAPTURE_FRAME_KIND.STATS_REPLY);
    assert.equal(frames[2].totalKernelPackets, 42);
    assert.equal(frames[2].totalKernelDrops, 0);
    assert.equal(frames[3].kind, CAPTURE_FRAME_KIND.FAULT);
    assert.equal(frames[3].faultCodeId, 1);
    assert.equal(frames[3].osErrno, 22);

    // Reject capLen > 131072 fail-closed
    const badHeader = Buffer.alloc(24);
    badHeader.writeUInt8(CAPTURE_FRAME_KIND.PACKET, 0);
    badHeader.writeUInt32BE(131073, 16);
    badHeader.writeUInt32BE(131073, 20);
    const badDecoder = createFrameDecoder(() => {});
    assert.throws(() => badDecoder.push(badHeader), /capLen/);
  });

  test("completes UDP-only startup self-test, processes barriers cleanly, withholds on drops, and drains deterministically", async () => {
    const observerDir = makeTempObserverDir();
    try {
      let dropCount = 0;
      let packetCount = 10;
      const harness = createFakeHarness({
        statsProvider: () => ({ packets: packetCount, drops: dropCount }),
      });

      const supervisor = createNativeObserverSupervisor({
        provenance: PROVENANCE,
        observerDir,
        requireRootOwnership: false,
        barrierTimeoutMs: 500,
        pollIntervalMs: 10,
        createUdpSocket: () => harness.udpSocket,
        spawnHelper: () => harness.helper,
        randomNonceHex: () => "0011223344556677",
      });

      const startupHealth = await supervisor.start();
      assert.equal(startupHealth.startupSelfTestPassed, true);
      assert.equal(startupHealth.barrierSequence, 0);
      assert.equal(startupHealth.sentinelPort, 49200);
      assert.equal(harness.sentUdp.length, 1);
      assert.equal(
        harness.sentUdp[0].text,
        `GWRK051:${PROVENANCE.runId}:0:0011223344556677`,
      );

      // Verify health sidecar written with mode 0600 and strict 7 keys
      const healthPath = join(observerDir, "native-observer-health.json");
      const healthStat = lstatSync(healthPath);
      assert.equal(healthStat.mode & 0o777, 0o600);
      const diskHealth = JSON.parse(readFileSync(healthPath, "utf8"));
      assert.equal(diskHealth.startupSelfTestPassed, true);
      assert.equal(diskHealth.captureStats.integrityFaultCode, null);

      // Feed one valid proxy request over passive pipe
      harness.emitPacket(
        buildTcpLoopback({
          srcPort: 45001,
          dstPort: 4180,
          seq: 10,
          flags: 0x02,
        }),
      );
      harness.emitPacket(
        buildTcpLoopback({
          srcPort: 45001,
          dstPort: 4180,
          seq: 11,
          flags: 0x18,
          payload:
            "GET /oauth2/start?rd=%2F HTTP/1.1\r\n" +
            "Host: 127.0.0.1:4180\r\n" +
            "X-Forwarded-For: 172.31.51.11\r\n\r\n",
        }),
      );

      // Write barrier file 1 with mode 0600
      const barrierPath = join(observerDir, "native-observation-barrier.json");
      writeFileSync(
        barrierPath,
        JSON.stringify({ version: 1, barrierSequence: 1 }),
        {
          mode: 0o600,
        },
      );

      packetCount = 25;
      const b1 = await supervisor.processBarrierFile();
      assert.equal(b1.advanced, true);
      assert.equal(b1.barrierSequence, 1);

      const obsPath = join(observerDir, "native-observation.json");
      const obsStat = lstatSync(obsPath);
      assert.equal(obsStat.mode & 0o777, 0o600);
      const obs = JSON.parse(readFileSync(obsPath, "utf8"));
      assert.doesNotThrow(() =>
        validateNativeObservation(obs, PROVENANCE, { minBarrierSequence: 1 }),
      );
      assert.equal(obs.proxyRequests.length, 1);

      // Now inject kernel drop on barrier 2: health latches fault and v1 snapshot barrierSequence MUST NOT advance
      dropCount = 1;
      packetCount = 30;
      writeFileSync(
        barrierPath,
        JSON.stringify({ version: 1, barrierSequence: 2 }),
        {
          mode: 0o600,
        },
      );
      const b2 = await supervisor.processBarrierFile();
      assert.equal(b2.advanced, false);
      assert.equal(b2.faultCode, "KERNEL_DROP_OBSERVED");

      const afterDropObs = JSON.parse(readFileSync(obsPath, "utf8"));
      assert.equal(afterDropObs.barrierSequence, 1);
      const afterDropHealth = JSON.parse(readFileSync(healthPath, "utf8"));
      assert.equal(
        afterDropHealth.captureStats.integrityFaultCode,
        "KERNEL_DROP_OBSERVED",
      );
      assert.equal(afterDropHealth.captureStats.kernelDrops, 1);
      assert.equal(afterDropHealth.barrierSequence, 1);

      // Deterministic drain sends 0x51 ('Q') and closes UDP socket
      await supervisor.stop();
      assert.equal(harness.receivedCommands.at(-1), 0x51);
      assert.equal(harness.udpSocket.closed, true);
    } finally {
      rmSync(observerDir, { recursive: true, force: true });
    }
  });

  test("latches BARRIER_TIMEOUT when sentinel or stats reply never arrives and fails closed on small SO_RCVBUF", async () => {
    const observerDir = makeTempObserverDir();
    try {
      // Fail closed when SO_RCVBUF < 512 KiB
      const smallBuf = createFakeHarness({ effectiveRcvBufBytes: 262144 });
      const smallSup = createNativeObserverSupervisor({
        provenance: PROVENANCE,
        observerDir,
        requireRootOwnership: false,
        barrierTimeoutMs: 200,
        createUdpSocket: () => smallBuf.udpSocket,
        spawnHelper: () => smallBuf.helper,
      });
      await assert.rejects(() => smallSup.start(), /SO_RCVBUF|524288/);
      await smallSup.stop();

      // Latch BARRIER_TIMEOUT when sentinel is dropped
      const timeoutHarness = createFakeHarness({ echoSentinel: false });
      const timeoutSup = createNativeObserverSupervisor({
        provenance: PROVENANCE,
        observerDir,
        requireRootOwnership: false,
        barrierTimeoutMs: 80,
        createUdpSocket: () => timeoutHarness.udpSocket,
        spawnHelper: () => timeoutHarness.helper,
      });
      await assert.rejects(() => timeoutSup.start(), /BARRIER_TIMEOUT/);
      const diskHealth = JSON.parse(
        readFileSync(join(observerDir, "native-observer-health.json"), "utf8"),
      );
      assert.equal(
        diskHealth.captureStats.integrityFaultCode,
        "BARRIER_TIMEOUT",
      );
      assert.equal(diskHealth.startupSelfTestPassed, false);
      await timeoutSup.stop();
    } finally {
      rmSync(observerDir, { recursive: true, force: true });
    }
  });

  test("rejects symlink observer directories, loose permissions, and symlink barrier files via lstatSync/O_NOFOLLOW", async () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk-obs-perm-"));
    try {
      const realDir = join(parent, "real");
      const linkDir = join(parent, "link");
      writeFileSync(
        join(parent, "target.json"),
        JSON.stringify({ version: 1, barrierSequence: 1 }),
        {
          mode: 0o600,
        },
      );
      // Loose directory permissions (0755)
      const looseDir = mkdtempSync(join(parent, "loose-"));
      chmodSync(looseDir, 0o755);
      assert.throws(
        () =>
          verifyObserverDirectory(looseDir, { requireRootOwnership: false }),
        /0700/,
      );

      // Symlink directory
      const goodDir = mkdtempSync(join(parent, "good-"));
      chmodSync(goodDir, 0o700);
      symlinkSync(goodDir, linkDir);
      assert.throws(
        () => verifyObserverDirectory(linkDir, { requireRootOwnership: false }),
        /symlink/i,
      );

      // Default requireRootOwnership rejects non-root user directories
      if (process.getuid?.() !== 0) {
        assert.throws(() => verifyObserverDirectory(goodDir), /root|uid/i);
      }

      // Symlink barrier file inside valid observerDir is rejected
      symlinkSync(
        join(parent, "target.json"),
        join(goodDir, "native-observation-barrier.json"),
      );
      const harness = createFakeHarness();
      const sup = createNativeObserverSupervisor({
        provenance: PROVENANCE,
        observerDir: goodDir,
        requireRootOwnership: false,
        barrierTimeoutMs: 300,
        createUdpSocket: () => harness.udpSocket,
        spawnHelper: () => harness.helper,
      });
      await sup.start();
      await assert.rejects(
        () => sup.processBarrierFile(),
        /symlink|ELOOP|regular/i,
      );
      rmSync(join(goodDir, "native-observation-barrier.json"));

      // Loose mode (0644) barrier file rejected
      const barrierPath = join(goodDir, "native-observation-barrier.json");
      writeFileSync(
        barrierPath,
        JSON.stringify({ version: 1, barrierSequence: 1 }),
        {
          mode: 0o644,
        },
      );
      chmodSync(barrierPath, 0o644);
      await assert.rejects(() => sup.processBarrierFile(), /0600/);

      // Mismatched runId in barrier file rejected
      writeFileSync(
        barrierPath,
        JSON.stringify({
          version: 1,
          barrierSequence: 1,
          runId: "0".repeat(24),
        }),
        { mode: 0o600 },
      );
      chmodSync(barrierPath, 0o600);
      await assert.rejects(() => sup.processBarrierFile(), /runId mismatch/);

      // Helper FAULT frame latches TRUNCATED_FRAME_OBSERVED and withholds barrier advance
      harness.emitFault(1, 0);
      writeFileSync(
        barrierPath,
        JSON.stringify({
          version: 1,
          barrierSequence: 1,
          runId: PROVENANCE.runId,
        }),
        { mode: 0o600 },
      );
      const faultRes = await sup.processBarrierFile();
      assert.equal(faultRes.advanced, false);
      assert.equal(faultRes.faultCode, "TRUNCATED_FRAME_OBSERVED");
      const faultHealth = JSON.parse(
        readFileSync(join(goodDir, "native-observer-health.json"), "utf8"),
      );
      assert.equal(
        faultHealth.captureStats.integrityFaultCode,
        "TRUNCATED_FRAME_OBSERVED",
      );
      assert.equal(faultHealth.captureStats.truncatedFrames, 1);

      await sup.stop();
      void realDir;
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("native-observer-capture.py pure structure, BPF bytecode, and stats tests", () => {
  test("compiles cleanly with py_compile and passes pure BPF VM (including Erratum 1), stats accumulation, and ordered startup tests", () => {
    const pycacheDir = mkdtempSync(join(tmpdir(), "gwrk-obs-pycache-"));
    try {
      execFileSync("python3", ["-m", "py_compile", CAPTURE_PY_PATH], {
        stdio: "pipe",
        timeout: 15_000,
        env: { ...process.env, PYTHONPYCACHEPREFIX: pycacheDir },
      });
    } finally {
      rmSync(pycacheDir, { recursive: true, force: true });
    }

    const pythonTestScript = `
import errno
import importlib.util
import struct
import sys

spec = importlib.util.spec_from_file_location("capture_mod", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

# Pure Classic BPF VM supporting Linux SKF_AD_PROTOCOL (-0x1000) and SKF_AD_PKTTYPE (-0x1000+4)
def run_bpf(insns, pkt, eth_proto, pkttype=0):
    A = 0
    X = 0
    pc = 0
    while pc < len(insns):
        code, jt, jf, k = insns[pc]
        cls = code & 0x07
        if cls == 0x00:  # BPF_LD
            size = code & 0x18
            mode = code & 0xe0
            if mode == 0x20:  # BPF_ABS
                if k == ((-0x1000) & 0xffffffff):
                    A = eth_proto
                elif k == ((-0x1000 + 4) & 0xffffffff):
                    A = pkttype
                elif size == 0x10:
                    if k >= len(pkt): return 0
                    A = pkt[k]
                elif size == 0x08:
                    if k + 2 > len(pkt): return 0
                    A = struct.unpack("!H", pkt[k:k+2])[0]
                elif size == 0x00:
                    if k + 4 > len(pkt): return 0
                    A = struct.unpack("!I", pkt[k:k+4])[0]
                else:
                    raise AssertionError(f"unsupported LD size {size}")
            elif mode == 0x40:  # BPF_IND
                off = X + k
                if size == 0x08:
                    if off + 2 > len(pkt): return 0
                    A = struct.unpack("!H", pkt[off:off+2])[0]
                elif size == 0x10:
                    if off >= len(pkt): return 0
                    A = pkt[off]
                else:
                    raise AssertionError(f"unsupported IND size {size}")
            else:
                raise AssertionError(f"unsupported LD mode {mode}")
            pc += 1
        elif cls == 0x01:  # BPF_LDX
            assert code == (0x01 | 0x10 | 0xa0), f"unexpected LDX {hex(code)}"
            if k >= len(pkt): return 0
            X = 4 * (pkt[k] & 0x0f)
            pc += 1
        elif cls == 0x05:  # BPF_JMP
            op = code & 0xf0
            if op == 0x10:  # JEQ
                cond = (A == k)
            elif op == 0x40:  # JSET
                cond = ((A & k) != 0)
            else:
                raise AssertionError(f"unsupported JMP {hex(op)}")
            pc += 1 + (jt if cond else jf)
        elif cls == 0x06:  # BPF_RET
            return k
        else:
            raise AssertionError(f"unsupported class {cls}")
    raise AssertionError("BPF fell off end")

def mk_ipv4(proto, src_port, dst_port, flags_frag=0, opt_len=0):
    ihl = (20 + opt_len) // 4
    ip = bytearray(20 + opt_len)
    ip[0] = (4 << 4) | ihl
    struct.pack_into("!H", ip, 2, len(ip) + 20)
    struct.pack_into("!H", ip, 6, flags_frag)
    ip[9] = proto
    l4 = bytearray(20)
    struct.pack_into("!HH", l4, 0, src_port, dst_port)
    return bytes(ip + l4)

def mk_ipv6(next_header, src_port, dst_port):
    ip6 = bytearray(40)
    ip6[0] = 0x60
    ip6[6] = next_header
    l4 = bytearray(20)
    struct.pack_into("!HH", l4, 0, src_port, dst_port)
    return bytes(ip6 + l4)

sentinel_port = 49333
prog_no_fb = mod.compile_bpf_program(sentinel_port, filter_outgoing=False)
prog_fb = mod.compile_bpf_program(sentinel_port, filter_outgoing=True)

# 1. Outgoing fallback drops pkttype == 4, accepts pkttype == 0
p_proxy_req = mk_ipv4(6, 55000, 4180)
assert run_bpf(prog_fb, p_proxy_req, 0x0800, pkttype=4) == 0
assert run_bpf(prog_fb, p_proxy_req, 0x0800, pkttype=0) == 131072

# 2. IPv4 TCP port filtering (accept dst 4180, src/dst 18790; drop src 4180 proxy responses and unrelated ports)
assert run_bpf(prog_no_fb, mk_ipv4(6, 55000, 4180), 0x0800) == 131072
assert run_bpf(prog_no_fb, mk_ipv4(6, 4180, 55000), 0x0800) == 0
assert run_bpf(prog_no_fb, mk_ipv4(6, 55000, 18790), 0x0800) == 131072
assert run_bpf(prog_no_fb, mk_ipv4(6, 18790, 55000), 0x0800) == 131072
assert run_bpf(prog_no_fb, mk_ipv4(6, 55000, 8080), 0x0800) == 0
# IPv4 with 8 bytes of IP options (IHL=7 -> 28-byte header)
assert run_bpf(prog_no_fb, mk_ipv4(6, 55000, 4180, opt_len=8), 0x0800) == 131072

# 3. IPv4 UDP sentinel filtering
assert run_bpf(prog_no_fb, mk_ipv4(17, 55000, sentinel_port), 0x0800) == 131072
assert run_bpf(prog_no_fb, mk_ipv4(17, 55000, sentinel_port + 1), 0x0800) == 0

# 4. IPv4 fragments on TCP or UDP accepted regardless of L4 ports so parser latches IPV4_FRAGMENT_OBSERVED
assert run_bpf(prog_no_fb, mk_ipv4(6, 1111, 2222, flags_frag=0x2000), 0x0800) == 131072
assert run_bpf(prog_no_fb, mk_ipv4(17, 1111, 2222, flags_frag=0x0005), 0x0800) == 131072
# DF bit alone (0x4000) is NOT fragmented
assert run_bpf(prog_no_fb, mk_ipv4(6, 1111, 2222, flags_frag=0x4000), 0x0800) == 0

# 5. Review Erratum 1: IPv6 nextHeader at byte 6 (NOT offset 40), TCP ports at 40 and 42
assert run_bpf(prog_no_fb, mk_ipv6(6, 55000, 4180), 0x86dd) == 131072
assert run_bpf(prog_no_fb, mk_ipv6(6, 18790, 55000), 0x86dd) == 131072
assert run_bpf(prog_no_fb, mk_ipv6(6, 55000, 18790), 0x86dd) == 131072
assert run_bpf(prog_no_fb, mk_ipv6(6, 55000, 9999), 0x86dd) == 0
# Non-TCP IPv6 (nextHeader=17) MUST drop even if byte 40 happens to be 6 (srcPort=0x0600)
assert run_bpf(prog_no_fb, mk_ipv6(17, 0x0600, 4180), 0x86dd) == 0

# 6. Cumulative PACKET_STATISTICS accumulator handles kernel resets without losing drops
acc = mod.StatsAccumulator()
assert acc.add_delta(10, 0) == (10, 0)
assert acc.add_delta(5, 2) == (15, 2)
assert acc.add_delta(7, 0) == (22, 2)

# 7. Ordered socket setup (protocol 0 -> SO_RCVBUF -> PACKET_IGNORE_OUTGOING fallback -> SO_ATTACH_FILTER -> bind -> setblocking)
calls = []
class FakeSocket:
    def __init__(self, family, stype, proto):
        calls.append(("socket", family, stype, proto))
        self.rcvbuf = 1048576
        self.fail_ignore_outgoing = True
    def setsockopt(self, level, optname, value):
        calls.append(("setsockopt", level, optname))
        if level == mod.SOL_PACKET and optname == mod.PACKET_IGNORE_OUTGOING and self.fail_ignore_outgoing:
            raise OSError(errno.ENOPROTOOPT, "Protocol not available")
    def getsockopt(self, level, optname):
        calls.append(("getsockopt", level, optname))
        return self.rcvbuf
    def bind(self, addr):
        calls.append(("bind", addr))
    def setblocking(self, flag):
        calls.append(("setblocking", flag))
    def close(self):
        calls.append(("close",))

sock, meta = mod.open_capture_socket(sentinel_port, socket_factory=FakeSocket)
assert meta["effective_rcvbuf"] == 1048576
assert meta["ignore_outgoing_kernel"] is False
assert meta["pkttype_bpf_fallback"] is True
op_order = [c[0] for c in calls]
assert op_order == ["socket", "setsockopt", "getsockopt", "setsockopt", "setsockopt", "bind", "setblocking"], op_order
assert calls[0] == ("socket", mod.AF_PACKET, mod.SOCK_DGRAM, 0)
assert calls[1] == ("setsockopt", mod.SOL_SOCKET, mod.SO_RCVBUF)
assert calls[2] == ("getsockopt", mod.SOL_SOCKET, mod.SO_RCVBUF)
assert calls[3] == ("setsockopt", mod.SOL_PACKET, mod.PACKET_IGNORE_OUTGOING)
assert calls[4] == ("setsockopt", mod.SOL_SOCKET, mod.SO_ATTACH_FILTER)
assert calls[5] == ("bind", ("", mod.ETH_P_ALL))
assert calls[6] == ("setblocking", False)

# Fail-closed when effective SO_RCVBUF < 524288
class SmallBufSocket(FakeSocket):
    def __init__(self, family, stype, proto):
        super().__init__(family, stype, proto)
        self.rcvbuf = 262144
try:
    mod.open_capture_socket(sentinel_port, socket_factory=SmallBufSocket)
    raise AssertionError("expected RcvBufTooSmallError")
except mod.RcvBufTooSmallError:
    pass

print("PYTHON_HELPER_CHECKS_OK")
`;

    const out = execFileSync(
      "python3",
      ["-c", pythonTestScript, CAPTURE_PY_PATH],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    assert.match(out, /PYTHON_HELPER_CHECKS_OK/);

    // CLI argument bounds check exits 64 before touching raw sockets
    assert.throws(
      () =>
        execFileSync("python3", [CAPTURE_PY_PATH, "80"], {
          stdio: "pipe",
          timeout: 10_000,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        }),
      (err) => err.status === 64,
    );
  });
});
