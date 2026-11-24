#!/usr/bin/env python3
"""Passive AF_PACKET capture helper for the hosted-pilot native observer.

Standard library only. Zero disk writes, zero external packages, zero HTTP endpoints.
Streams 24-byte big-endian framed records over stdout and accepts 1-byte commands
('S' drain+stats, 'Q' quit) over stdin.
"""

import ctypes
import errno
import os
import selectors
import signal
import socket
import struct
import sys
import time

# Linux AF_PACKET / socket constants
AF_PACKET = getattr(socket, "AF_PACKET", 17)
SOCK_DGRAM = getattr(socket, "SOCK_DGRAM", 2)
ETH_P_ALL = 0x0003
ETH_P_IP = 0x0800
ETH_P_IPV6 = 0x86DD

SOL_SOCKET = getattr(socket, "SOL_SOCKET", 1)
SO_RCVBUF = getattr(socket, "SO_RCVBUF", 8)
SO_ATTACH_FILTER = 26

SOL_PACKET = 263
PACKET_STATISTICS = 6
PACKET_IGNORE_OUTGOING = 23
PACKET_OUTGOING = 4
MSG_TRUNC = getattr(socket, "MSG_TRUNC", 0x20)

REQUESTED_RCVBUF_BYTES = 4 * 1024 * 1024
MIN_RCVBUF_BYTES = 524288
MAX_CAPTURE_BYTES = 131072
PROXY_PORT = 4180
ORIGIN_PORT = 18790

# Binary framing constants (Appendix 3.3)
HEADER_STRUCT = struct.Struct("!BBHIQII")
READY_STRUCT = struct.Struct("!IBB10x")
STATS_STRUCT = struct.Struct("!QQ")
FAULT_STRUCT = struct.Struct("!II")

KIND_PACKET = 1
KIND_STATS_REPLY = 2
KIND_READY = 3
KIND_FAULT = 4

FAULT_TRUNCATED_FRAME = 1
FAULT_KERNEL_DROP = 2
FAULT_RCVBUF_TOO_SMALL = 3
FAULT_SOCKET_ERROR = 4

CMD_STATS = 0x53  # 'S'
CMD_QUIT = 0x51  # 'Q'

# Classic BPF opcodes (Linux docs.kernel.org/networking/filter.html)
BPF_LD = 0x00
BPF_LDX = 0x01
BPF_JMP = 0x05
BPF_RET = 0x06

BPF_W = 0x00
BPF_H = 0x08
BPF_B = 0x10

BPF_ABS = 0x20
BPF_IND = 0x40
BPF_MSH = 0xA0

BPF_JEQ = 0x10
BPF_JSET = 0x40
BPF_K = 0x00

SKF_AD_OFF = -0x1000
SKF_AD_PROTOCOL = 0
SKF_AD_PKTTYPE = 4
SKF_AD_PROTOCOL_U32 = (SKF_AD_OFF + SKF_AD_PROTOCOL) & 0xFFFFFFFF
SKF_AD_PKTTYPE_U32 = (SKF_AD_OFF + SKF_AD_PKTTYPE) & 0xFFFFFFFF


class RcvBufTooSmallError(RuntimeError):
    """Raised when effective kernel SO_RCVBUF falls below 512 KiB."""

    def __init__(self, effective_bytes: int):
        super().__init__(
            f"effective SO_RCVBUF {effective_bytes} below minimum {MIN_RCVBUF_BYTES}"
        )
        self.effective_bytes = effective_bytes


class SockFilter(ctypes.Structure):
    _fields_ = [
        ("code", ctypes.c_ushort),
        ("jt", ctypes.c_ubyte),
        ("jf", ctypes.c_ubyte),
        ("k", ctypes.c_uint),
    ]


class SockFprog(ctypes.Structure):
    _fields_ = [
        ("len", ctypes.c_ushort),
        ("filter", ctypes.c_void_p),
    ]


class StatsAccumulator:
    """Accumulates kernel PACKET_STATISTICS reset deltas into monotonic u64 totals."""

    def __init__(self):
        self.total_packets = 0
        self.total_drops = 0

    def add_delta(self, tp_packets: int, tp_drops: int) -> tuple[int, int]:
        if tp_packets < 0 or tp_drops < 0:
            raise ValueError("packet statistics deltas must be non-negative")
        self.total_packets += int(tp_packets)
        self.total_drops += int(tp_drops)
        return self.total_packets, self.total_drops


def compile_bpf_program(
    sentinel_port: int,
    *,
    filter_outgoing: bool = False,
    proxy_port: int = PROXY_PORT,
    origin_port: int = ORIGIN_PORT,
) -> list[tuple[int, int, int, int]]:
    """Compile Classic BPF bytecode for AF_PACKET SOCK_DGRAM (L3 at offset 0).

    Review Erratum 1: IPv6 nextHeader is read at byte offset 6, TCP ports at 40 and 42.
    """
    if not (1024 <= int(sentinel_port) <= 65535):
        raise ValueError("sentinel_port must be in 1024..65535")

    items: list[tuple] = []

    def label(name: str):
        items.append(("LABEL", name))

    def insn(code: int, k: int):
        items.append(("INSN", code, 0, 0, k & 0xFFFFFFFF))

    def jmp(code: int, k: int, jt_label: str | None, jf_label: str | None):
        items.append(("JMP", code, jt_label, jf_label, k & 0xFFFFFFFF))

    if filter_outgoing:
        insn(BPF_LD | BPF_W | BPF_ABS, SKF_AD_PKTTYPE_U32)
        jmp(BPF_JMP | BPF_JEQ | BPF_K, PACKET_OUTGOING, "DROP", None)

    insn(BPF_LD | BPF_W | BPF_ABS, SKF_AD_PROTOCOL_U32)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, ETH_P_IP, "IPV4", None)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, ETH_P_IPV6, "IPV6", "DROP")

    label("IPV4")
    insn(BPF_LD | BPF_B | BPF_ABS, 9)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, 6, "IPV4_TCP", None)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, 17, "IPV4_UDP", "DROP")

    label("IPV4_TCP")
    insn(BPF_LD | BPF_H | BPF_ABS, 6)
    jmp(BPF_JMP | BPF_JSET | BPF_K, 0x3FFF, "ACCEPT", None)
    insn(BPF_LDX | BPF_B | BPF_MSH, 0)
    insn(BPF_LD | BPF_H | BPF_IND, 0)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, origin_port, "ACCEPT", None)
    insn(BPF_LD | BPF_H | BPF_IND, 2)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, proxy_port, "ACCEPT", None)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, origin_port, "ACCEPT", "DROP")

    label("IPV4_UDP")
    insn(BPF_LD | BPF_H | BPF_ABS, 6)
    jmp(BPF_JMP | BPF_JSET | BPF_K, 0x3FFF, "ACCEPT", None)
    insn(BPF_LDX | BPF_B | BPF_MSH, 0)
    insn(BPF_LD | BPF_H | BPF_IND, 2)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, sentinel_port, "ACCEPT", "DROP")

    # Erratum 1: IPv6 nextHeader at byte offset 6, TCP src/dst ports at 40 and 42
    label("IPV6")
    insn(BPF_LD | BPF_B | BPF_ABS, 6)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, 6, None, "DROP")
    insn(BPF_LD | BPF_H | BPF_ABS, 40)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, origin_port, "ACCEPT", None)
    insn(BPF_LD | BPF_H | BPF_ABS, 42)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, proxy_port, "ACCEPT", None)
    jmp(BPF_JMP | BPF_JEQ | BPF_K, origin_port, "ACCEPT", "DROP")

    label("ACCEPT")
    insn(BPF_RET | BPF_K, MAX_CAPTURE_BYTES)

    label("DROP")
    insn(BPF_RET | BPF_K, 0)

    label_offsets: dict[str, int] = {}
    pc = 0
    for item in items:
        if item[0] == "LABEL":
            label_offsets[item[1]] = pc
        else:
            pc += 1

    compiled: list[tuple[int, int, int, int]] = []
    pc = 0
    for item in items:
        if item[0] == "LABEL":
            continue
        if item[0] == "INSN":
            _, code, jt, jf, k = item
            compiled.append((code, jt, jf, k))
        else:
            _, code, jt_label, jf_label, k = item
            jt = 0 if jt_label is None else label_offsets[jt_label] - (pc + 1)
            jf = 0 if jf_label is None else label_offsets[jf_label] - (pc + 1)
            if not (0 <= jt <= 255 and 0 <= jf <= 255):
                raise ValueError("BPF jump offset out of range")
            compiled.append((code, jt, jf, k))
        pc += 1
    return compiled


def pack_sock_fprog(insns: list[tuple[int, int, int, int]]):
    array_type = SockFilter * len(insns)
    arr = array_type(*(SockFilter(c, jt, jf, k) for (c, jt, jf, k) in insns))
    fprog = SockFprog(len(insns), ctypes.addressof(arr))
    return arr, fprog


def encode_frame(
    kind: int,
    payload: bytes = b"",
    *,
    pkttype: int = 0,
    eth_proto: int = 0,
    ifindex: int = 0,
    monotonic_ns: int = 0,
    orig_len: int | None = None,
) -> bytes:
    cap_len = len(payload)
    if cap_len > MAX_CAPTURE_BYTES:
        raise ValueError("payload exceeds MAX_CAPTURE_BYTES")
    actual_orig = cap_len if orig_len is None else orig_len
    header = HEADER_STRUCT.pack(
        kind,
        pkttype,
        eth_proto,
        ifindex,
        monotonic_ns,
        actual_orig,
        cap_len,
    )
    return header + payload


def encode_ready_frame(
    effective_rcvbuf: int,
    ignore_outgoing_kernel: bool,
    pkttype_bpf_fallback: bool,
    *,
    monotonic_ns: int = 0,
) -> bytes:
    payload = READY_STRUCT.pack(
        effective_rcvbuf,
        1 if ignore_outgoing_kernel else 0,
        1 if pkttype_bpf_fallback else 0,
    )
    return encode_frame(KIND_READY, payload, monotonic_ns=monotonic_ns)


def encode_stats_frame(
    total_packets: int,
    total_drops: int,
    *,
    monotonic_ns: int = 0,
) -> bytes:
    payload = STATS_STRUCT.pack(total_packets, total_drops)
    return encode_frame(KIND_STATS_REPLY, payload, monotonic_ns=monotonic_ns)


def encode_fault_frame(
    fault_code_id: int,
    os_errno: int = 0,
    *,
    monotonic_ns: int = 0,
) -> bytes:
    payload = FAULT_STRUCT.pack(fault_code_id, os_errno)
    return encode_frame(KIND_FAULT, payload, monotonic_ns=monotonic_ns)


def monotonic_raw_ns() -> int:
    clk = getattr(time, "CLOCK_MONOTONIC_RAW", time.CLOCK_MONOTONIC)
    return time.clock_gettime_ns(clk)


def open_capture_socket(
    sentinel_port: int,
    *,
    proxy_port: int = PROXY_PORT,
    origin_port: int = ORIGIN_PORT,
    socket_factory=socket.socket,
):
    """Open and harden AF_PACKET SOCK_DGRAM in exact Appendix 3.1 order."""
    # 1. Protocol 0 queues zero packets during setup
    sock = socket_factory(AF_PACKET, SOCK_DGRAM, 0)
    try:
        # 2. Request 4 MiB SO_RCVBUF and verify >= 512 KiB
        sock.setsockopt(SOL_SOCKET, SO_RCVBUF, REQUESTED_RCVBUF_BYTES)
        effective = sock.getsockopt(SOL_SOCKET, SO_RCVBUF)
        if effective < MIN_RCVBUF_BYTES:
            raise RcvBufTooSmallError(effective)

        # 3. Try PACKET_IGNORE_OUTGOING; fall back to SKF_AD_PKTTYPE BPF prologue on ENOPROTOOPT
        ignore_outgoing_kernel = True
        pkttype_bpf_fallback = False
        try:
            sock.setsockopt(SOL_PACKET, PACKET_IGNORE_OUTGOING, 1)
        except OSError as exc:
            if exc.errno == errno.ENOPROTOOPT:
                ignore_outgoing_kernel = False
                pkttype_bpf_fallback = True
            else:
                raise

        # 4-8. Compile and attach BPF filter before binding ETH_P_ALL
        bpf_insns = compile_bpf_program(
            sentinel_port,
            filter_outgoing=pkttype_bpf_fallback,
            proxy_port=proxy_port,
            origin_port=origin_port,
        )
        _keepalive_arr, fprog = pack_sock_fprog(bpf_insns)
        sock.setsockopt(SOL_SOCKET, SO_ATTACH_FILTER, bytes(fprog))

        # 9. Bind ETH_P_ALL on ifindex 0 ("") inside owned --network none namespace
        sock.bind(("", ETH_P_ALL))

        # 10. Non-blocking capture mode
        sock.setblocking(False)
        return sock, {
            "effective_rcvbuf": effective,
            "ignore_outgoing_kernel": ignore_outgoing_kernel,
            "pkttype_bpf_fallback": pkttype_bpf_fallback,
        }
    except Exception:
        sock.close()
        raise


def write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    written = 0
    while written < len(view):
        n = os.write(fd, view[written:])
        if n <= 0:
            raise BrokenPipeError("stdout pipe closed")
        written += n


def drain_socket_frames(sock, out_fd: int) -> None:
    while True:
        try:
            data, _anc, msg_flags, addr = sock.recvmsg(MAX_CAPTURE_BYTES, 0, MSG_TRUNC)
        except BlockingIOError:
            return
        ts = monotonic_raw_ns()
        if msg_flags & MSG_TRUNC:
            write_all(out_fd, encode_fault_frame(FAULT_TRUNCATED_FRAME, 0, monotonic_ns=ts))
            continue
        # AF_PACKET addr tuple: (ifname, proto, pkttype, hatype, addr)
        eth_proto = int(addr[1]) if len(addr) > 1 else 0
        pkttype = int(addr[2]) if len(addr) > 2 else 0
        if pkttype == PACKET_OUTGOING:
            continue
        ifindex = 0
        if len(addr) > 0 and addr[0]:
            try:
                ifindex = socket.if_nametoindex(addr[0])
            except OSError:
                ifindex = 0
        frame = encode_frame(
            KIND_PACKET,
            data,
            pkttype=pkttype,
            eth_proto=eth_proto,
            ifindex=ifindex,
            monotonic_ns=ts,
            orig_len=len(data),
        )
        write_all(out_fd, frame)


def read_packet_statistics(sock, accumulator: StatsAccumulator) -> tuple[int, int]:
    raw = sock.getsockopt(SOL_PACKET, PACKET_STATISTICS, 8)
    tp_packets, tp_drops = struct.unpack("=II", raw)
    return accumulator.add_delta(tp_packets, tp_drops)


def run_capture(sentinel_port: int) -> int:
    out_fd = sys.stdout.fileno()
    in_fd = sys.stdin.fileno()
    stop_requested = False

    def handle_signal(_signum, _frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        sock, meta = open_capture_socket(sentinel_port)
    except RcvBufTooSmallError as exc:
        sys.stderr.write(f"observer capture startup failed: {exc}\n")
        return 2
    except OSError as exc:
        sys.stderr.write(f"observer capture socket error errno={exc.errno}\n")
        return 3

    accumulator = StatsAccumulator()
    sel = selectors.DefaultSelector()
    try:
        write_all(
            out_fd,
            encode_ready_frame(
                meta["effective_rcvbuf"],
                meta["ignore_outgoing_kernel"],
                meta["pkttype_bpf_fallback"],
                monotonic_ns=monotonic_raw_ns(),
            ),
        )
        os.set_blocking(in_fd, False)
        sel.register(sock, selectors.EVENT_READ, data="sock")
        sel.register(in_fd, selectors.EVENT_READ, data="stdin")

        while not stop_requested:
            events = sel.select(timeout=0.25)
            for key, _mask in events:
                if key.data == "sock":
                    drain_socket_frames(sock, out_fd)
                elif key.data == "stdin":
                    try:
                        cmd_bytes = os.read(in_fd, 64)
                    except BlockingIOError:
                        continue
                    if not cmd_bytes:
                        stop_requested = True
                        break
                    for b in cmd_bytes:
                        if b == CMD_STATS:
                            drain_socket_frames(sock, out_fd)
                            total_pkts, total_drops = read_packet_statistics(sock, accumulator)
                            write_all(
                                out_fd,
                                encode_stats_frame(
                                    total_pkts,
                                    total_drops,
                                    monotonic_ns=monotonic_raw_ns(),
                                ),
                            )
                        elif b == CMD_QUIT:
                            stop_requested = True
                            break
        return 0
    except BrokenPipeError:
        return 0
    finally:
        sel.close()
        sock.close()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: native-observer-capture.py <sentinel_port>\n")
        return 64
    try:
        sentinel_port = int(argv[1], 10)
    except ValueError:
        sys.stderr.write("invalid sentinel_port\n")
        return 64
    if not (1024 <= sentinel_port <= 65535):
        sys.stderr.write("sentinel_port out of range 1024..65535\n")
        return 64
    return run_capture(sentinel_port)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
