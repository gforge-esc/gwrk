import assert from "node:assert/strict";

export const DIND_IMAGE =
  "docker.io/library/docker:29.10.0-dind@sha256:4bbc7223f81db790097c6dea42fb93e05b8fead4f0431fbe6ccaba6e8473201c";
export const RESOURCE_LIMITS = Object.freeze({
  cpu: 2,
  memoryBytes: 2 * 1024 ** 3,
  pids: 1024,
  dataBytes: 12 * 1024 ** 3,
  startupSeconds: 90,
  suiteSeconds: 600,
  cleanupSeconds: 60,
});

// This check gates the future controller. It performs no Docker or filesystem I/O.
export function requireExecutionCheckpoint(receipt) {
  assert.equal(
    receipt.approvedPrivilegedExecution,
    true,
    "privileged execution awaits the coordinator checkpoint",
  );
  assert.equal(
    receipt.outerImage,
    DIND_IMAGE,
    "daemon image differs from the frozen pin",
  );
  assert.equal(
    receipt.dataBudgetBytes,
    RESOURCE_LIMITS.dataBytes,
    "a different data budget requires another review",
  );
  assert.ok(
    Number.isSafeInteger(receipt.estimatedDataBytes) &&
      receipt.estimatedDataBytes > 0,
    "missing measured storage estimate",
  );
  assert.ok(
    receipt.estimatedDataBytes <= receipt.dataBudgetBytes,
    "VFS estimate exceeds the data budget",
  );
  assert.ok(
    Number.isSafeInteger(receipt.backingAvailableBytes) &&
      receipt.backingAvailableBytes >=
        receipt.estimatedDataBytes + 4 * 1024 ** 3,
    "Docker VM backing free space is insufficient",
  );
  assert.ok(
    Number.isSafeInteger(receipt.rootAvailableBytes) &&
      receipt.rootAvailableBytes >= 8 * 1024 ** 3,
    "host root free space is insufficient",
  );
  assert.match(
    receipt.nodeImageId ?? "",
    /^sha256:[a-f0-9]{64}$/,
    "missing built Node image ID",
  );
  assert.match(
    receipt.sourceCommit ?? "",
    /^[a-f0-9]{40}$/,
    "missing source commit",
  );
  assert.match(
    receipt.archiveSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "missing preload archive hash",
  );
  assert.ok(
    receipt.approvedPassiveNetRaw === undefined ||
      typeof receipt.approvedPassiveNetRaw === "boolean",
    "approvedPassiveNetRaw must be a boolean",
  );
  assert.ok(
    receipt.approvedScenarioBSynGate === undefined ||
      typeof receipt.approvedScenarioBSynGate === "boolean",
    "approvedScenarioBSynGate must be a boolean",
  );
  if (receipt.verificationMode !== undefined) {
    assert.ok(
      receipt.verificationMode === "observer-selftest" ||
        receipt.verificationMode === "gateway-matrix",
      "unsupported verificationMode",
    );
  }
  if (receipt.verificationMode === "observer-selftest") {
    assert.notEqual(
      receipt.purpose,
      "acceptance",
      "observer-selftest cannot be used under acceptance purpose",
    );
    assert.equal(
      receipt.purpose,
      "behavioral-red",
      "observer-selftest requires behavioral-red purpose",
    );
  }
  if (receipt.purpose === "acceptance")
    assert.equal(
      receipt.reviewedSource,
      true,
      "known RED source cannot establish acceptance",
    );
  else
    assert.equal(
      receipt.purpose,
      "behavioral-red",
      "unsupported fixture purpose",
    );
}

export function ownedRuntimePlan({
  runId,
  inputDirectory,
  dataDirectory,
  receipt,
}) {
  requireExecutionCheckpoint(receipt);
  assert.match(runId, /^[a-f0-9]{24}$/, "invalid owned run ID");
  assert.ok(
    inputDirectory.startsWith("/") && !inputDirectory.split("/").includes(".."),
    "input directory must be absolute and canonical",
  );
  const name = `gwrk-051-nested-${runId}`;
  assert.equal(
    inputDirectory,
    `/opt/gwrk-verification/${runId}/input`,
    "fixture input path differs from owned namespace",
  );
  assert.equal(
    dataDirectory,
    `/var/lib/gwrk/verification-fixtures/${runId}`,
    "fixture data path differs from approved mount",
  );
  const label = `gwrk.fixture.run=${runId}`;
  const command = [
    "create",
    "--name",
    name,
    "--label",
    "gwrk.fixture=phase7-051",
    "--label",
    label,
    "--pull",
    "never",
    "--platform",
    "linux/amd64",
    "--privileged",
    "--cpus",
    "2",
    "--memory",
    String(RESOURCE_LIMITS.memoryBytes),
    "--memory-swap",
    String(RESOURCE_LIMITS.memoryBytes),
    "--pids-limit",
    "1024",
    "--network",
    "none",
    "--ipc",
    "private",
    "--mount",
    `type=bind,source=${inputDirectory},target=/input,readonly`,
    "--mount",
    `type=bind,source=${dataDirectory},target=/var/lib/docker`,
    "--env",
    "DOCKER_TLS_CERTDIR=",
    "--env",
    "DOCKER_IPTABLES_LEGACY=",
    DIND_IMAGE,
    "dockerd",
    "--host=unix:///var/run/docker.sock",
    "--storage-driver=vfs",
    "--feature=containerd-snapshotter=false",
    "--data-root=/var/lib/docker",
    "--exec-root=/run/gwrk-051-daemon",
    "--pidfile=/run/gwrk-051-daemon.pid",
    "--userland-proxy=false",
  ];
  // Persist these owned names before creating either resource. Never use global prune.
  return {
    name,
    dataDirectory,
    label,
    command,
    cleanup: [["rm", "--force", name]],
    dataCleanupRequiresIdentityReceipt: true,
  };
}
