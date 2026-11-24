import { spawn } from "node:child_process";

export class FixtureProcessError extends Error {
  constructor(code, closed) {
    super(`Owned fixture process failed: ${code}`);
    this.code = code;
    this.closed = closed;
  }
}

export function startBoundedProcess(
  command,
  args,
  {
    signal,
    env,
    timeoutMs = 30_000,
    termGraceMs = 1000,
    killGraceMs = 1000,
    maxOutputBytes = 1048576,
    onSpawn,
  } = {},
) {
  if (signal?.aborted) throw new FixtureProcessError("cancelled", true);
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let closed = false;
  let settled = false;
  let reason;
  let escalation;
  let killDeadline;
  let resolve;
  let reject;
  const chunks = { stdout: [], stderr: [] };
  let bytes = 0;
  const completion = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(escalation);
    clearTimeout(killDeadline);
    signal?.removeEventListener("abort", cancel);
    if (error) reject(error);
    else resolve(value);
  };
  const stop = (code = "cancelled") => {
    if (closed || reason) return;
    reason = code;
    child.kill("SIGTERM");
    escalation = setTimeout(() => {
      if (closed) return;
      child.kill("SIGKILL");
      killDeadline = setTimeout(
        () => finish(new FixtureProcessError("drain_unconfirmed", false)),
        killGraceMs,
      );
    }, termGraceMs);
  };
  const cancel = () => stop("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  for (const stream of ["stdout", "stderr"])
    child[stream].on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop("output_bound");
      else chunks[stream].push(chunk);
    });
  child.once("error", () => {
    closed = true;
    finish(new FixtureProcessError("spawn", true));
  });
  child.once("close", (code, signalName) => {
    closed = true;
    if (reason) finish(new FixtureProcessError(reason, true));
    else
      finish(undefined, {
        code,
        signal: signalName,
        stdout: Buffer.concat(chunks.stdout).toString(),
        stderr: Buffer.concat(chunks.stderr).toString(),
      });
  });
  onSpawn?.(child);
  return { completion, stop, isClosed: () => closed, pid: child.pid };
}

// SIGTERM and SIGINT enter the same cancellation path as command deadlines.
// Owned cleanup runs only after tracked CLI processes close or drain is disproven.
export async function runOwnedProcessScope(
  action,
  cleanup,
  { processTarget = process, termGraceMs = 1000, killGraceMs = 1000 } = {},
) {
  const controller = new AbortController();
  const handles = new Set();
  let interrupted;
  const interrupt = (signal) => {
    interrupted ??= signal;
    controller.abort();
  };
  const term = () => interrupt("SIGTERM");
  const int = () => interrupt("SIGINT");
  processTarget.on("SIGTERM", term);
  processTarget.on("SIGINT", int);
  const untilCancelled = (promise) => {
    if (controller.signal.aborted)
      return Promise.reject(new FixtureProcessError("cancelled", true));
    return new Promise((resolve, reject) => {
      const cancel = () => reject(new FixtureProcessError("cancelled", true));
      controller.signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve(promise)
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", cancel));
    });
  };
  const spawnProcess = (command, args, options = {}) => {
    const handle = startBoundedProcess(command, args, {
      ...options,
      signal: controller.signal,
      termGraceMs,
      killGraceMs,
    });
    handles.add(handle);
    // Attach a rejection observer before cancellation can settle the command.
    handle.completion.catch(() => {});
    return handle.completion;
  };
  try {
    return await action({
      signal: controller.signal,
      spawnProcess,
      untilCancelled,
    });
  } finally {
    controller.abort();
    for (const handle of handles) handle.stop();
    await Promise.allSettled([...handles].map((handle) => handle.completion));
    const childrenDrained = [...handles].every((handle) => handle.isClosed());
    try {
      await cleanup({ childrenDrained, interrupted });
    } finally {
      processTarget.off("SIGTERM", term);
      processTarget.off("SIGINT", int);
    }
  }
}
