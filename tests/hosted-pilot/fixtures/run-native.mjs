import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildLifecycleFailureReceipt,
  classifyDockerFailure,
  digestText,
} from "./docker-diagnostics.mjs";
import {
  FixtureLifecycleError,
  withOwnedNestedDaemon,
} from "./nested-lifecycle.mjs";

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function runNativeFixture({
  runId,
  root,
  receipt,
  images,
  withLifecycle = withOwnedNestedDaemon,
  files = { existsSync, readFileSync, writeFileSync },
}) {
  const resultPath = `${root}/native-result.json`;
  let resultWritten = false;
  let caseStage = "outer_lifecycle";
  try {
    await withLifecycle({
      runId,
      receipt,
      executeCases: async ({ containerId, docker, spawnDocker }) => {
        caseStage = "image_preload";
        const load = await spawnDocker(
          [
            "exec",
            containerId,
            "docker",
            "--host",
            "unix:///var/run/docker.sock",
            "load",
            "--input",
            "/input/preload-images.tar",
          ],
          240_000,
        );
        if (load.code !== 0) {
          const diagnostic = classifyDockerFailure("load", load);
          const stdoutDigest = digestText(load.stdout);
          throw new FixtureLifecycleError(
            "offline preloaded image import failed",
            {
              stage: "image_preload",
              category: diagnostic.category,
              detail: diagnostic.detail,
              operation: "docker_load_preload",
              exitCode: diagnostic.exitCode ?? 1,
              stdoutBytes: stdoutDigest.bytes,
              stderrBytes: diagnostic.stderrBytes,
              stdoutSha256: stdoutDigest.sha256,
              stderrSha256: diagnostic.stderrSha256,
            },
          );
        }
        for (const name of ["node", "traefik", "proxy"]) {
          const image = JSON.parse(
            await docker([
              "exec",
              containerId,
              "docker",
              "image",
              "inspect",
              "--format",
              "{{json .}}",
              images[name],
            ]),
          );
          assert.equal(
            image.Id,
            images[name],
            "loaded image configuration identity differs",
          );
          assert.deepEqual(
            image.RootFS.Layers,
            images.rootfs[name],
            "loaded image rootfs differs",
          );
        }
        caseStage = "controller_setup";
        await docker([
          "exec",
          containerId,
          "mkdir",
          "-p",
          "/fixture",
          "/etc/gwrk",
        ]);
        const controller = `gwrk-051-controller-${runId}`;
        files.writeFileSync(
          `${root}/controller-ownership.json`,
          JSON.stringify({
            runId,
            name: controller,
            nestedDaemonOnly: true,
            outerContainer: containerId,
          }),
          { mode: 0o600 },
        );
        caseStage = "controller_execution";
        const result = await spawnDocker(
          [
            "exec",
            containerId,
            "docker",
            "run",
            "--rm",
            "--name",
            controller,
            "--label",
            `gwrk.fixture.run=${runId}`,
            "--pull",
            "never",
            "--network",
            "host",
            "--user",
            "0:0",
            "--cap-drop",
            "ALL",
            "--cap-add",
            "CHOWN",
            "--cap-add",
            "DAC_OVERRIDE",
            "--cap-add",
            "FOWNER",
            "--security-opt",
            "no-new-privileges",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=32m",
            "--env",
            "DOCKER_HOST=unix:///var/run/docker.sock",
            "--env",
            "GWRK_051_OWNED_CONTROLLER=1",
            "--env",
            `GWRK_051_RUN_ID=${runId}`,
            "--mount",
            "type=bind,source=/input,target=/input,readonly",
            "--mount",
            "type=bind,source=/fixture,target=/fixture",
            "--mount",
            "type=bind,source=/etc/gwrk,target=/etc/gwrk",
            // This is the owned outer daemon's socket. The AWS host socket is never mounted.
            "--mount",
            "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
            images.node,
            "node",
            "/input/fixtures/bootstrap.mjs",
          ],
          360_000,
        );
        let stage;
        try {
          stage = JSON.parse(
            await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/bootstrap-stage.json",
            ]),
          );
        } catch {}
        const safe = {
          runId,
          exitCode: result.code,
          stdoutBytes: Buffer.byteLength(result.stdout),
          stderrBytes: Buffer.byteLength(result.stderr),
          stdoutSha256: createHash("sha256")
            .update(result.stdout)
            .digest("hex"),
          stderrSha256: createHash("sha256")
            .update(result.stderr)
            .digest("hex"),
          nativeBehavioralRed:
            result.code !== 0 && stage?.failureClassification === "behavioral",
          stage: stage?.stage ?? "unavailable",
          fixtureConstructionFailure:
            stage?.failureClassification === "fixture_construction",
          positiveAcceptance: false,
        };
        if (stage?.category) {
          safe.category = stage.category;
        }
        if (stage?.detail) {
          safe.detail = stage.detail;
        }
        if (stage?.operation) {
          safe.operation = stage.operation;
        }
        if (Number.isFinite(stage?.elapsedMs)) {
          safe.elapsedMs = stage.elapsedMs;
        }
        if (stage?.errorCode !== undefined) {
          safe.errorCode = stage.errorCode;
        }
        if (stage?.errorSignal !== undefined) {
          safe.errorSignal = stage.errorSignal;
        }
        if (stage?.exitStatus !== undefined) {
          safe.exitStatus = stage.exitStatus;
        }
        files.writeFileSync(resultPath, JSON.stringify(safe, null, 2), {
          mode: 0o600,
        });
        resultWritten = true;
        assert.equal(
          result.code,
          0,
          "native gateway behavioral assertions failed",
        );
      },
    });
  } catch (error) {
    if (!resultWritten && !files.existsSync(resultPath)) {
      const safe = buildLifecycleFailureReceipt({
        runId,
        error,
        fallbackStage: caseStage,
      });
      files.writeFileSync(resultPath, JSON.stringify(safe, null, 2), {
        mode: 0o600,
      });
    }
    throw error;
  }
}

async function main() {
  const receiptPath = process.argv[2];
  assert.match(
    receiptPath ?? "",
    /^\/opt\/gwrk-verification\/[a-f0-9]{24}\/execution-checkpoint\.json$/,
  );
  const metadata = lstatSync(receiptPath);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.uid, 0);
  assert.equal(metadata.mode & 0o777, 0o600);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const runId = receipt.runId;
  assert.equal(
    receiptPath,
    `/opt/gwrk-verification/${runId}/execution-checkpoint.json`,
  );
  const root = `/opt/gwrk-verification/${runId}`;
  const scriptManifestPath = `${root}/input/script-manifest.json`;
  assert.equal(
    await hashFile(scriptManifestPath),
    receipt.scriptManifestSha256,
    "runtime script manifest differs from review",
  );
  const scriptManifest = JSON.parse(readFileSync(scriptManifestPath, "utf8"));
  for (const [name, digest] of Object.entries(scriptManifest)) {
    assert.match(name, /^[a-z-]+\.mjs$/);
    const path = `${root}/input/fixtures/${name}`;
    const entryMetadata = lstatSync(path);
    assert.ok(
      entryMetadata.isFile() &&
        !entryMetadata.isSymbolicLink() &&
        entryMetadata.uid === 0,
    );
    assert.equal(
      await hashFile(path),
      digest,
      "runtime script differs from review",
    );
  }
  assert.equal(
    await hashFile(`${root}/input/preload-images.tar`),
    receipt.archiveSha256,
    "preload archive hash differs",
  );
  const images = JSON.parse(
    readFileSync(`${root}/input/loaded-images.json`, "utf8"),
  );
  writeFileSync(`${root}/input/runtime-receipt.json`, JSON.stringify(receipt), {
    mode: 0o600,
  });
  await runNativeFixture({ runId, root, receipt, images });
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  existsSync(invokedPath) &&
  realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
