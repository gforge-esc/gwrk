import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DIND_IMAGE,
  RESOURCE_LIMITS,
  ownedRuntimePlan,
  requireExecutionCheckpoint,
} from "./runtime-policy.mjs";
const receipt = () => ({
  approvedPrivilegedExecution: true,
  outerImage: DIND_IMAGE,
  dataBudgetBytes: RESOURCE_LIMITS.dataBytes,
  estimatedDataBytes: 10 * 1024 ** 3,
  backingAvailableBytes: 20 * 1024 ** 3,
  rootAvailableBytes: 10 * 1024 ** 3,
  nodeImageId: `sha256:${"a".repeat(64)}`,
  sourceCommit: "b".repeat(40),
  archiveSha256: "c".repeat(64),
  purpose: "behavioral-red",
  reviewedSource: false,
});

test("blocks current oversized VFS estimate and backing space without side effects", () => {
  assert.throws(
    () =>
      requireExecutionCheckpoint({
        ...receipt(),
        estimatedDataBytes: 23356112384,
      }),
    /exceeds/,
  );
  assert.throws(
    () =>
      requireExecutionCheckpoint({
        ...receipt(),
        backingAvailableBytes: 750997504,
      }),
    /insufficient/,
  );
  assert.throws(
    () =>
      requireExecutionCheckpoint({
        ...receipt(),
        approvedPrivilegedExecution: false,
      }),
    /awaits/,
  );
});

test("known RED source cannot become an acceptance receipt", () => {
  assert.doesNotThrow(() => requireExecutionCheckpoint(receipt()));
  assert.throws(
    () => requireExecutionCheckpoint({ ...receipt(), purpose: "acceptance" }),
    /known RED/,
  );
  assert.doesNotThrow(() =>
    requireExecutionCheckpoint({
      ...receipt(),
      purpose: "acceptance",
      reviewedSource: true,
    }),
  );
});

test("keeps Unix-only daemon and bounded owned cleanup without host socket or ports", () => {
  const plan = ownedRuntimePlan({
    runId: "1".repeat(24),
    inputDirectory: `/opt/gwrk-verification/${"1".repeat(24)}/input`,
    dataDirectory: `/var/lib/gwrk/verification-fixtures/${"1".repeat(24)}`,
    receipt: receipt(),
  });
  assert.deepEqual(plan.cleanup, [["rm", "--force", plan.name]]);
  assert.equal(plan.command.includes("--publish"), false);
  assert.equal(plan.command.includes("--network"), true);
  assert.equal(plan.command[plan.command.indexOf("--network") + 1], "none");
  assert.equal(
    plan.command.filter((value) => value.includes("/var/run/docker.sock"))
      .length,
    1,
  );
  assert.equal(plan.command[plan.command.indexOf(DIND_IMAGE) + 1], "dockerd");
  assert.equal(
    plan.command.some((value) => value.includes("tcp://")),
    false,
  );
  assert.equal(
    plan.command.some((value) => value === "prune"),
    false,
  );
  assert.equal(plan.command[plan.command.indexOf("--cpus") + 1], "2");
});

test("uses Docker's supported default private PID namespace without an invalid private flag", () => {
  const runId = "1".repeat(24);
  const plan = ownedRuntimePlan({
    runId,
    inputDirectory: `/opt/gwrk-verification/${runId}/input`,
    dataDirectory: `/var/lib/gwrk/verification-fixtures/${runId}`,
    receipt: receipt(),
  });
  assert.equal(
    plan.command.includes("--pid"),
    false,
    "Docker PID private isolation uses its default empty mode",
  );
  assert.equal(plan.command[plan.command.indexOf("--ipc") + 1], "private");
});
