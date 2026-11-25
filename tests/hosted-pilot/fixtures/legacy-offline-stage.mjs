import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as defaultFs from "node:fs";
import path from "node:path";

async function loadYamlModule() {
  try {
    return await import("yaml");
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") {
      throw err;
    }
  }
  try {
    return await import("/app/node_modules/yaml/dist/index.js");
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") {
      throw err;
    }
  }
  return await import(
    path.join(process.cwd(), "node_modules/yaml/dist/index.js")
  );
}

const { isAlias, isMap, isScalar, isSeq, parseDocument } =
  await loadYamlModule();

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

const COMPOSE_YAML_REL = "deploy/hosted-auth-proof/compose.yaml";
const COMPOSE_TEST_YAML_REL = "tests/hosted-auth-proof/compose.test.yaml";
const GATEWAY_PROOF_REL = "tests/hosted-auth-proof/gateway-proof.mjs";

const REQUIRED_MANIFEST_ENTRIES = Object.freeze([
  COMPOSE_YAML_REL,
  COMPOSE_TEST_YAML_REL,
  GATEWAY_PROOF_REL,
]);

const ALLOWED_IMAGE_SERVICES_BY_FILE = Object.freeze({
  [COMPOSE_YAML_REL]: new Set(["traefik", "oauth2-proxy", "status"]),
  [COMPOSE_TEST_YAML_REL]: new Set(["issuer"]),
});

export const LEGACY_IMAGE_ROLES = Object.freeze([
  "traefik",
  "proxy",
  "nginx",
  "issuerNode",
]);

export const FROZEN_SOURCE_PINS = Object.freeze({
  traefik:
    "traefik:v3.7.18@sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635",
  proxy:
    "quay.io/oauth2-proxy/oauth2-proxy:v7.15.6@sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048",
  nginx:
    "nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311",
  issuerNode:
    "node:20-alpine@sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8",
});

export const FROZEN_LEGACY_SOURCE_MANIFEST = Object.freeze({
  "deploy/hosted-auth-proof/.env.example":
    "31adbffe30510f0f1b2b8b81de48877939f4f2a81e22729c2660e16ff426d504",
  "deploy/hosted-auth-proof/.gitignore":
    "b95c89a7c1ad7a586f232f664eacd3cb77bd6875efcc608eb4c3d060b2e52977",
  "deploy/hosted-auth-proof/README.md":
    "42c876f0660b44c47beef06e8531a72553209e9a0c3890b280401a1a04f7d191",
  "deploy/hosted-auth-proof/compose.yaml":
    "bc089fb9fd9703f96f1ff7e214ca601ea5788604dd10bed55a46796418392e52",
  "deploy/hosted-auth-proof/live-acceptance.example.md":
    "3e78049d66ef32d779ac8645831e68df9d713d6ba1dcf61826befcf7e4829c79",
  "deploy/hosted-auth-proof/oauth2-proxy/oauth2-proxy.cfg":
    "8ea2834042ee7fe8286825767dc39830379502be058aa0351867f0767ce950d3",
  "deploy/hosted-auth-proof/preflight.sh":
    "35fbaa3a0db2664d43203e879274fa1593e05d8ad579b8c7d52c8a254af446c2",
  "deploy/hosted-auth-proof/status/default.conf":
    "c07109b76db64fc0367734732dfe9ffba2331dccf292a6c63ec9a72f67198290",
  "deploy/hosted-auth-proof/traefik/dynamic.yaml":
    "563a3fa414c5848b443e58099b65136522362862ea5a0f18ae288e179312f319",
  "tests/hosted-auth-proof/compose.test.yaml":
    "9e42ae1762e0e2b25cc417c2d506c87c1c8f9a025c4700cc96b31544e7a91e12",
  "tests/hosted-auth-proof/gateway-proof.mjs":
    "a7f6079db2ff651153fd96802282138ff96da8cb41462a831c07460a6e10741c",
  "tests/hosted-auth-proof/oidc-issuer.mjs":
    "226071c60405713828f9778d9199c5d3838aabb2b430b05c772ca0cb676ea6d2",
  "tests/hosted-auth-proof/preflight.test.ts":
    "dc9a9585dc0607d6702fc04237defb4dd3552ef382b859d55d3254bdb0dc90c1",
  "tests/hosted-auth-proof/production-bundle.test.ts":
    "4267ba0cc3c8bb8244efa25ca925a4bdbfc40fb81b86f1dca66ed0e3ef04464f",
});

export const YAML_CUSTOM_TAGS = [
  { tag: "!override", collection: "seq" },
  { tag: "!override", collection: "map" },
  { tag: "!override", resolve: (val) => val },
  { tag: "!reset", collection: "seq" },
  { tag: "!reset", collection: "map" },
  { tag: "!reset", resolve: (val) => (val === "null" ? null : val) },
];

export class LegacyOfflineStageError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LegacyOfflineStageError";
    this.details = details;
  }
}

export function assertSafeRelativePath(relPath) {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new LegacyOfflineStageError("Path must be a non-empty string");
  }
  if (relPath.includes("\0")) {
    throw new LegacyOfflineStageError(
      `path escape: null byte rejected in path: ${relPath}`,
    );
  }
  if (relPath.includes("\\")) {
    throw new LegacyOfflineStageError(
      `path escape: backslash rejected in path: ${relPath}`,
    );
  }
  if (relPath.startsWith("/") || relPath.endsWith("/")) {
    throw new LegacyOfflineStageError(
      `path escape: leading or trailing slash rejected: ${relPath}`,
    );
  }
  const segments = relPath.split("/");
  if (
    segments.includes("..") ||
    segments.includes(".") ||
    segments.includes("")
  ) {
    throw new LegacyOfflineStageError(
      `path escape: non-canonical segment rejected in path: ${relPath}`,
    );
  }
}

function lstatIfExists(fs, targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw new LegacyOfflineStageError(
      `Failed to inspect path ${targetPath}: ${err.message}`,
      { targetPath, originalError: err.message },
    );
  }
}

function isDarwinSystemSymlink(p) {
  if (process.platform !== "darwin") return false;
  return p === "/var" || p === "/tmp" || p === "/etc";
}

function assertNoSymlinkPath(fs, targetPath, label) {
  const resolved = path.resolve(targetPath);
  const parts = resolved.split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = lstatIfExists(fs, current);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      if (isDarwinSystemSymlink(current)) {
        continue;
      }
      throw new LegacyOfflineStageError(
        `symlink rejected in ${label}: ${current}`,
        { label, symlinkPath: current, targetPath },
      );
    }
  }
}

function assertNoSymlinkRelativeChain(fs, baseDir, relPath, label) {
  const segments = relPath.split("/");
  let current = baseDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = lstatIfExists(fs, current);
    if (!stat) {
      throw new LegacyOfflineStageError(
        `Source file missing from source tree: ${relPath}`,
        { relPath, missingPath: current },
      );
    }
    if (stat.isSymbolicLink()) {
      throw new LegacyOfflineStageError(
        `symlink rejected in ${label}: ${relPath}`,
        { label, relPath, symlinkPath: current },
      );
    }
  }
}

function isStrictDescendant(parentPath, childPath) {
  const rel = path.relative(parentPath, childPath);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function assertDocumentHasNoErrors(doc, fileName) {
  if (Array.isArray(doc?.errors) && doc.errors.length > 0) {
    throw new LegacyOfflineStageError(
      `YAML parse error in ${fileName}: ${doc.errors[0].message}`,
      { fileName, errors: doc.errors.map((e) => e.message) },
    );
  }
}

export function normalizeAst(node, pathArr = [], allowedServices = null) {
  if (isAlias(node)) {
    return {
      type: "alias",
      tag: node.tag ?? null,
      source: node.source,
    };
  }
  if (isMap(node)) {
    return {
      type: "map",
      tag: node.tag ?? null,
      anchor: node.anchor ?? null,
      items: node.items.map((pair) => {
        const keyStr = String(pair.key?.value ?? pair.key);
        return {
          key: normalizeAst(pair.key, pathArr, allowedServices),
          value: normalizeAst(
            pair.value,
            [...pathArr, keyStr],
            allowedServices,
          ),
        };
      }),
    };
  }
  if (isSeq(node)) {
    return {
      type: "seq",
      tag: node.tag ?? null,
      anchor: node.anchor ?? null,
      items: node.items.map((item, idx) =>
        normalizeAst(item, [...pathArr, String(idx)], allowedServices),
      ),
    };
  }
  if (isScalar(node)) {
    const isImageField =
      pathArr.length === 3 &&
      pathArr[0] === "services" &&
      pathArr[2] === "image" &&
      (allowedServices ? allowedServices.has(pathArr[1]) : false);
    return {
      type: "scalar",
      tag: node.tag ?? null,
      anchor: node.anchor ?? null,
      value: isImageField ? "__PERMITTED_IMAGE_SCALAR__" : node.value,
    };
  }
  return {
    type: "primitive",
    tag: node?.tag ?? null,
    anchor: node?.anchor ?? null,
    value: node?.value ?? node,
  };
}

export function verifyRequiredComposeTags(doc, fileName = "") {
  if (!fileName.endsWith("compose.test.yaml")) return;
  const traefik = doc.getIn(["services", "traefik"]);
  if (!traefik) {
    throw new LegacyOfflineStageError(
      `Missing services.traefik in ${fileName}`,
    );
  }
  for (const field of ["ports", "command", "volumes", "networks"]) {
    const node = traefik.get?.(field, true);
    if (node?.tag !== "!override") {
      throw new LegacyOfflineStageError(
        `Changed custom tag: expected !override on services.traefik.${field} in ${fileName}, got ${node?.tag}`,
        {
          service: "traefik",
          field,
          expectedTag: "!override",
          actualTag: node?.tag,
        },
      );
    }
  }
  const auth = doc.getIn(["networks", "auth"]);
  const ipam = auth?.get?.("ipam", true);
  if (ipam?.tag !== "!reset") {
    throw new LegacyOfflineStageError(
      `Changed custom tag: expected !reset on networks.auth.ipam in ${fileName}, got ${ipam?.tag}`,
      {
        network: "auth",
        field: "ipam",
        expectedTag: "!reset",
        actualTag: ipam?.tag,
      },
    );
  }
}

export function assertNormalizedAstEquality(
  sourceDoc,
  stagedDoc,
  fileName = "",
) {
  assertDocumentHasNoErrors(sourceDoc, fileName);
  assertDocumentHasNoErrors(stagedDoc, fileName);
  const allowedServices =
    ALLOWED_IMAGE_SERVICES_BY_FILE[fileName] ??
    (fileName.endsWith("compose.test.yaml")
      ? ALLOWED_IMAGE_SERVICES_BY_FILE[COMPOSE_TEST_YAML_REL]
      : fileName.endsWith("compose.yaml")
        ? ALLOWED_IMAGE_SERVICES_BY_FILE[COMPOSE_YAML_REL]
        : new Set());
  const normSource = normalizeAst(sourceDoc.contents, [], allowedServices);
  const normStaged = normalizeAst(stagedDoc.contents, [], allowedServices);
  try {
    assert.deepEqual(normSource, normStaged);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `Normalized AST equality check failed: non-image edit or altered custom tag in ${fileName}`,
      { originalError: err.message, fileName },
    );
  }
}

export function validateLoadedImages(loadedImages) {
  if (
    !loadedImages ||
    typeof loadedImages !== "object" ||
    Array.isArray(loadedImages)
  ) {
    throw new LegacyOfflineStageError("Missing loaded images map");
  }
  const keys = Object.keys(loadedImages);
  for (const role of LEGACY_IMAGE_ROLES) {
    if (!Object.hasOwn(loadedImages, role) || !loadedImages[role]) {
      throw new LegacyOfflineStageError(
        `missing required legacy image role: ${role}`,
        { role },
      );
    }
  }
  for (const key of keys) {
    if (!LEGACY_IMAGE_ROLES.includes(key)) {
      throw new LegacyOfflineStageError(
        `unknown or additional legacy image role: ${key}`,
        { role: key },
      );
    }
  }
}

export async function verifyLoadedImageIdentities(loadedImages, inspectPort) {
  validateLoadedImages(loadedImages);
  if (!inspectPort) {
    throw new LegacyOfflineStageError(
      "Missing inspectPort for loaded image verification",
    );
  }

  const seenIds = new Set();
  for (const role of LEGACY_IMAGE_ROLES) {
    const item = loadedImages[role];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new LegacyOfflineStageError(
        `Loaded image metadata for role ${role} must include imageId and rootfsLayers`,
        { role },
      );
    }
    const imageId = item.imageId;
    const expectedLayers = Array.isArray(item.rootfsLayers)
      ? item.rootfsLayers
      : Array.isArray(item.rootfsDiffIds)
        ? item.rootfsDiffIds
        : null;

    if (typeof imageId !== "string" || !SHA256_DIGEST_RE.test(imageId)) {
      throw new LegacyOfflineStageError(
        `Invalid loaded image ID for role ${role}: ${imageId}`,
        { role, imageId },
      );
    }
    if (seenIds.has(imageId)) {
      throw new LegacyOfflineStageError(
        `Duplicate loaded image ID reused for role ${role}: ${imageId}`,
        { role, imageId },
      );
    }
    seenIds.add(imageId);

    if (
      !Array.isArray(expectedLayers) ||
      expectedLayers.length === 0 ||
      !expectedLayers.every(
        (layer) => typeof layer === "string" && SHA256_DIGEST_RE.test(layer),
      )
    ) {
      throw new LegacyOfflineStageError(
        `Missing or invalid rootfs layers metadata for role ${role}`,
        { role, expectedLayers },
      );
    }

    let inspected;
    try {
      if (typeof inspectPort.inspectImage === "function") {
        inspected = await inspectPort.inspectImage(imageId);
      } else if (typeof inspectPort === "function") {
        inspected = await inspectPort(imageId);
      } else {
        throw new Error("inspectPort does not provide inspectImage function");
      }
    } catch (err) {
      throw new LegacyOfflineStageError(
        `Failed to inspect loaded image payload for role ${role} (${imageId}): ${err.message}`,
        { role, imageId, originalError: err.message },
      );
    }

    if (!inspected) {
      throw new LegacyOfflineStageError(
        `No inspection result returned for role ${role} (${imageId})`,
        { role, imageId },
      );
    }

    const actualId = inspected.Id ?? inspected.imageId;
    if (actualId !== imageId) {
      throw new LegacyOfflineStageError(
        `payload identity mismatch for role ${role}: expected ${imageId}, inspected ${actualId}`,
        { role, expected: imageId, actual: actualId },
      );
    }

    const actualLayers =
      inspected.RootFS?.Layers ??
      inspected.rootfsLayers ??
      inspected.rootfsDiffIds;
    if (!Array.isArray(actualLayers) || actualLayers.length === 0) {
      throw new LegacyOfflineStageError(
        `Missing rootfs layers in inspect result for role ${role}`,
        { role, inspected },
      );
    }
    try {
      assert.deepEqual(actualLayers, expectedLayers);
    } catch {
      throw new LegacyOfflineStageError(
        `payload identity rootfs layer mismatch for role ${role}`,
        { role, expectedLayers, actualLayers },
      );
    }
  }
}

export async function checkLegacyOfflinePreflight({
  tmpdir = "/fixture/legacy-tmp",
  sharedMountPath = "/fixture",
  mountChecker,
  commandRunner,
  filesystem,
} = {}) {
  const fs = filesystem ?? defaultFs;

  if (!tmpdir || typeof tmpdir !== "string" || !path.isAbsolute(tmpdir)) {
    throw new LegacyOfflineStageError(
      "TMPDIR must be a non-empty absolute path string",
    );
  }
  if (
    !sharedMountPath ||
    typeof sharedMountPath !== "string" ||
    !path.isAbsolute(sharedMountPath)
  ) {
    throw new LegacyOfflineStageError(
      "sharedMountPath must be a non-empty absolute path string",
    );
  }

  const normalizedShared = path.resolve(sharedMountPath);
  const normalizedTmp = path.resolve(tmpdir);
  if (
    normalizedTmp === "/tmp" ||
    normalizedTmp === "/var/tmp" ||
    normalizedTmp.startsWith("/tmp/") ||
    normalizedTmp.startsWith("/var/tmp/")
  ) {
    throw new LegacyOfflineStageError(
      `private /tmp location rejected for legacy proof: TMPDIR must be under shared ${normalizedShared}, got ${tmpdir}`,
      { tmpdir },
    );
  }

  if (!isStrictDescendant(normalizedShared, normalizedTmp)) {
    throw new LegacyOfflineStageError(
      `TMPDIR must be strictly inside shared mount ${normalizedShared}, got ${tmpdir}`,
      { tmpdir, sharedMountPath: normalizedShared },
    );
  }

  assertNoSymlinkPath(fs, normalizedShared, "sharedMountPath");
  assertNoSymlinkPath(fs, normalizedTmp, "tmpdir");

  if (typeof mountChecker === "function") {
    try {
      const ok = await mountChecker({
        sharedMountPath: normalizedShared,
        tmpdir: normalizedTmp,
      });
      if (ok !== true) {
        throw new Error("mountChecker returned false");
      }
    } catch (err) {
      throw new LegacyOfflineStageError(
        `wrong mount identity for shared path ${normalizedShared}: ${err.message}`,
        { sharedMountPath: normalizedShared, originalError: err.message },
      );
    }
  } else {
    const mountinfoPath = "/proc/self/mountinfo";
    if (!fs.existsSync(mountinfoPath)) {
      throw new LegacyOfflineStageError(
        `wrong mount identity: cannot verify ${normalizedShared} because ${mountinfoPath} is unavailable`,
        { sharedMountPath: normalizedShared, mountinfoPath },
      );
    }
    const lines = fs.readFileSync(mountinfoPath, "utf8").trim().split("\n");
    const mountPoints = new Set(
      lines.map((line) => line.split(" ")[4]).filter(Boolean),
    );
    if (!mountPoints.has(normalizedShared)) {
      throw new LegacyOfflineStageError(
        `wrong mount identity: ${normalizedShared} is not a mounted target in ${mountinfoPath}`,
        { sharedMountPath: normalizedShared },
      );
    }
    if (mountPoints.has(normalizedTmp)) {
      throw new LegacyOfflineStageError(
        `wrong mount identity: ${normalizedTmp} is a separate mount overriding ${normalizedShared}`,
        { sharedMountPath: normalizedShared, tmpdir: normalizedTmp },
      );
    }
  }

  try {
    fs.mkdirSync(normalizedTmp, { recursive: true, mode: 0o755 });
    fs.chmodSync(normalizedTmp, 0o755);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `Failed to create or set mode 0755 on TMPDIR ${normalizedTmp}: ${err.message}`,
      { tmpdir: normalizedTmp, originalError: err.message },
    );
  }

  assertNoSymlinkPath(fs, normalizedTmp, "tmpdir");
  const sharedStat = fs.lstatSync(normalizedShared);
  const tmpStat = fs.lstatSync(normalizedTmp);
  if (!tmpStat.isDirectory() || tmpStat.dev !== sharedStat.dev) {
    throw new LegacyOfflineStageError(
      `wrong mount identity: ${normalizedTmp} does not share device with ${normalizedShared}`,
      { sharedMountPath: normalizedShared, tmpdir: normalizedTmp },
    );
  }

  const runner =
    commandRunner ??
    ((cmd) => {
      return execFileSync(cmd[0], cmd.slice(1), {
        encoding: "utf8",
        timeout: 5000,
        stdio: "pipe",
      });
    });

  try {
    runner(["openssl", "version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'openssl': ${err.message}`,
      { dependency: "openssl", originalError: err.message },
    );
  }

  try {
    runner(["curl", "--version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'curl': ${err.message}`,
      { dependency: "curl", originalError: err.message },
    );
  }

  try {
    runner(["docker", "compose", "version"]);
  } catch (err) {
    throw new LegacyOfflineStageError(
      `missing required dependency 'compose': ${err.message}`,
      { dependency: "compose", originalError: err.message },
    );
  }

  return {
    tmpdir: normalizedTmp,
    sharedMountPath: normalizedShared,
    mode: 0o755,
  };
}

export async function stageLegacyOffline({
  sourceRoot,
  destinationRoot,
  trustedSourceManifest = FROZEN_LEGACY_SOURCE_MANIFEST,
  loadedImages,
  inspectPort,
  tmpdir = "/fixture/legacy-tmp",
  sharedMountPath = "/fixture",
  filesystem,
  mountChecker,
  commandRunner,
  skipPreflight = false,
}) {
  const fs = filesystem ?? defaultFs;

  if (!skipPreflight) {
    await checkLegacyOfflinePreflight({
      tmpdir,
      sharedMountPath,
      mountChecker,
      commandRunner,
      filesystem: fs,
    });
  }

  await verifyLoadedImageIdentities(loadedImages, inspectPort);

  if (!sourceRoot || typeof sourceRoot !== "string") {
    throw new LegacyOfflineStageError(
      `Source root directory does not exist: ${sourceRoot}`,
      { sourceRoot },
    );
  }
  assertNoSymlinkPath(fs, sourceRoot, "sourceRoot");
  const sourceRootStat = lstatIfExists(fs, sourceRoot);
  if (!sourceRootStat || !sourceRootStat.isDirectory()) {
    throw new LegacyOfflineStageError(
      `Source root directory does not exist: ${sourceRoot}`,
      { sourceRoot },
    );
  }

  if (!destinationRoot || typeof destinationRoot !== "string") {
    throw new LegacyOfflineStageError(
      `Destination root must be a non-empty path: ${destinationRoot}`,
      { destinationRoot },
    );
  }
  assertNoSymlinkPath(fs, destinationRoot, "destinationRoot");

  if (
    !trustedSourceManifest ||
    typeof trustedSourceManifest !== "object" ||
    Array.isArray(trustedSourceManifest)
  ) {
    throw new LegacyOfflineStageError("Missing trustedSourceManifest");
  }
  for (const requiredRel of REQUIRED_MANIFEST_ENTRIES) {
    if (!Object.hasOwn(trustedSourceManifest, requiredRel)) {
      throw new LegacyOfflineStageError(
        `trustedSourceManifest missing required legacy entry: ${requiredRel}`,
        { requiredRel },
      );
    }
  }

  const destStat = lstatIfExists(fs, destinationRoot);
  if (destStat) {
    if (destStat.isSymbolicLink()) {
      throw new LegacyOfflineStageError(
        `symlink rejected: destination directory is a symbolic link: ${destinationRoot}`,
        { destinationRoot },
      );
    }
    if (!destStat.isDirectory()) {
      throw new LegacyOfflineStageError(
        `destination path already exists and is not a directory: ${destinationRoot}`,
        { destinationRoot },
      );
    }
    const existing = fs.readdirSync(destinationRoot);
    if (existing.length > 0) {
      throw new LegacyOfflineStageError(
        `destination directory already exists and is not empty: ${destinationRoot}`,
        { destinationRoot },
      );
    }
  } else {
    fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o755 });
  }

  const originalHashes = {};
  const stagedHashes = {};
  const verifiedFiles = new Map();

  for (const [relPath, expectedHash] of Object.entries(trustedSourceManifest)) {
    assertSafeRelativePath(relPath);
    assertNoSymlinkRelativeChain(fs, sourceRoot, relPath, "source tree");
    const fullSourcePath = path.join(sourceRoot, relPath);
    const lstat = lstatIfExists(fs, fullSourcePath);
    if (!lstat) {
      throw new LegacyOfflineStageError(
        `Source file missing from source tree: ${relPath}`,
        { relPath, fullSourcePath },
      );
    }
    if (lstat.isSymbolicLink()) {
      throw new LegacyOfflineStageError(
        `symlink rejected in source tree: ${relPath}`,
        { relPath },
      );
    }
    if (!lstat.isFile()) {
      throw new LegacyOfflineStageError(
        `Source entry is not a regular file: ${relPath}`,
        { relPath },
      );
    }

    const raw = fs.readFileSync(fullSourcePath);
    const actualHash = createHash("sha256").update(raw).digest("hex");
    if (actualHash !== expectedHash) {
      throw new LegacyOfflineStageError(
        `source hash mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`,
        { relPath, expectedHash, actualHash },
      );
    }
    originalHashes[relPath] = actualHash;
    verifiedFiles.set(relPath, { raw, mode: lstat.mode & 0o777 });
  }

  for (const [relPath, { raw, mode }] of verifiedFiles.entries()) {
    const fullDestPath = path.join(destinationRoot, relPath);
    const parentDir = path.dirname(fullDestPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true, mode: 0o755 });
    }
    if (lstatIfExists(fs, fullDestPath)) {
      throw new LegacyOfflineStageError(
        `destination file already exists: ${fullDestPath}`,
        { fullDestPath },
      );
    }

    if (relPath === COMPOSE_YAML_REL) {
      const sourceContent = raw.toString("utf8");
      const sourceDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      const stagedDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      assertDocumentHasNoErrors(sourceDoc, relPath);

      const traefikSrc = sourceDoc.getIn(["services", "traefik", "image"]);
      if (traefikSrc !== FROZEN_SOURCE_PINS.traefik) {
        throw new LegacyOfflineStageError(
          `wrong source pin for traefik in ${relPath}: expected ${FROZEN_SOURCE_PINS.traefik}, got ${traefikSrc}`,
          {
            service: "traefik",
            expected: FROZEN_SOURCE_PINS.traefik,
            actual: traefikSrc,
          },
        );
      }
      const proxySrc = sourceDoc.getIn(["services", "oauth2-proxy", "image"]);
      if (proxySrc !== FROZEN_SOURCE_PINS.proxy) {
        throw new LegacyOfflineStageError(
          `wrong source pin for oauth2-proxy in ${relPath}: expected ${FROZEN_SOURCE_PINS.proxy}, got ${proxySrc}`,
          {
            service: "oauth2-proxy",
            expected: FROZEN_SOURCE_PINS.proxy,
            actual: proxySrc,
          },
        );
      }
      const nginxSrc = sourceDoc.getIn(["services", "status", "image"]);
      if (nginxSrc !== FROZEN_SOURCE_PINS.nginx) {
        throw new LegacyOfflineStageError(
          `wrong source pin for status/nginx in ${relPath}: expected ${FROZEN_SOURCE_PINS.nginx}, got ${nginxSrc}`,
          {
            service: "status",
            expected: FROZEN_SOURCE_PINS.nginx,
            actual: nginxSrc,
          },
        );
      }

      stagedDoc.setIn(
        ["services", "traefik", "image"],
        loadedImages.traefik.imageId,
      );
      stagedDoc.setIn(
        ["services", "oauth2-proxy", "image"],
        loadedImages.proxy.imageId,
      );
      stagedDoc.setIn(
        ["services", "status", "image"],
        loadedImages.nginx.imageId,
      );

      assertNormalizedAstEquality(sourceDoc, stagedDoc, relPath);

      const stagedYamlStr = stagedDoc.toString();
      fs.writeFileSync(fullDestPath, stagedYamlStr, { mode });
      fs.chmodSync(fullDestPath, mode);

      const diskYaml = fs.readFileSync(fullDestPath, "utf8");
      const reReadDoc = parseDocument(diskYaml, {
        customTags: YAML_CUSTOM_TAGS,
      });
      assertNormalizedAstEquality(sourceDoc, reReadDoc, relPath);

      stagedHashes[relPath] = createHash("sha256")
        .update(diskYaml)
        .digest("hex");
    } else if (relPath === COMPOSE_TEST_YAML_REL) {
      const sourceContent = raw.toString("utf8");
      const sourceDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      const stagedDoc = parseDocument(sourceContent, {
        customTags: YAML_CUSTOM_TAGS,
      });
      assertDocumentHasNoErrors(sourceDoc, relPath);

      verifyRequiredComposeTags(sourceDoc, relPath);

      const issuerSrc = sourceDoc.getIn(["services", "issuer", "image"]);
      if (issuerSrc !== FROZEN_SOURCE_PINS.issuerNode) {
        throw new LegacyOfflineStageError(
          `wrong source pin for issuer in ${relPath}: expected ${FROZEN_SOURCE_PINS.issuerNode}, got ${issuerSrc}`,
          {
            service: "issuer",
            expected: FROZEN_SOURCE_PINS.issuerNode,
            actual: issuerSrc,
          },
        );
      }

      stagedDoc.setIn(
        ["services", "issuer", "image"],
        loadedImages.issuerNode.imageId,
      );

      verifyRequiredComposeTags(stagedDoc, relPath);
      assertNormalizedAstEquality(sourceDoc, stagedDoc, relPath);

      const stagedYamlStr = stagedDoc.toString();
      fs.writeFileSync(fullDestPath, stagedYamlStr, { mode });
      fs.chmodSync(fullDestPath, mode);

      const diskYaml = fs.readFileSync(fullDestPath, "utf8");
      const reReadDoc = parseDocument(diskYaml, {
        customTags: YAML_CUSTOM_TAGS,
      });
      verifyRequiredComposeTags(reReadDoc, relPath);
      assertNormalizedAstEquality(sourceDoc, reReadDoc, relPath);

      stagedHashes[relPath] = createHash("sha256")
        .update(diskYaml)
        .digest("hex");
    } else {
      fs.writeFileSync(fullDestPath, raw, { mode });
      fs.chmodSync(fullDestPath, mode);
      stagedHashes[relPath] = createHash("sha256").update(raw).digest("hex");
    }
  }

  const locatorMap = {
    traefik: {
      sourcePin: FROZEN_SOURCE_PINS.traefik,
      stagedImageId: loadedImages.traefik.imageId,
    },
    proxy: {
      sourcePin: FROZEN_SOURCE_PINS.proxy,
      stagedImageId: loadedImages.proxy.imageId,
    },
    nginx: {
      sourcePin: FROZEN_SOURCE_PINS.nginx,
      stagedImageId: loadedImages.nginx.imageId,
    },
    issuerNode: {
      sourcePin: FROZEN_SOURCE_PINS.issuerNode,
      stagedImageId: loadedImages.issuerNode.imageId,
    },
  };

  return {
    originalHashes,
    stagedHashes,
    locatorMap,
    env: {
      TMPDIR: tmpdir,
    },
    stagedSourceRoot: destinationRoot,
    stagedScriptPath: path.join(destinationRoot, GATEWAY_PROOF_REL),
  };
}
