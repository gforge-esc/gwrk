/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pure retention and disk preflight policy. No I/O and no third-party imports:
// the release installer runs this before `pnpm install` provides dependencies.

export const GIB = 1024 ** 3;

export type ArtifactKind = "release" | "verification-run" | "docker-image";

export interface InventoryItem {
  readonly kind: ArtifactKind;
  /** Release version, verification run ID, or Docker image config ID. */
  readonly id: string;
  readonly path?: string;
  /** True only when the adapter positively proved gwrk ownership. */
  readonly owned: boolean;
  readonly unknownReason?: string;
  readonly completedAt?: string;
  /** Identity hash the application rechecks before deletion. */
  readonly identity: string;
  readonly bytes: number;
  /** Verification runs: bytes in manifested heavy payloads still present. */
  readonly heavyBytes?: number;
  /** Docker images: owning verification run. */
  readonly runId?: string;
  /** Docker images: referenced by any container. */
  readonly inUse?: boolean;
}

export interface Protections {
  readonly releases: readonly string[];
  readonly runs: readonly string[];
  readonly images: readonly string[];
}

export interface RetentionPolicy {
  readonly keepReleases: number;
  readonly keepRuns: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  keepReleases: 2,
  keepRuns: 2,
};

export type RetentionActionKind =
  | "delete-release"
  | "prune-run-heavy"
  | "delete-image";

export interface RetentionAction {
  readonly action: RetentionActionKind;
  readonly item: InventoryItem;
}

export type KeepReason =
  | "protected"
  | "recent"
  | "incomplete"
  | "in-use"
  | "run-kept"
  | "already-pruned";

export interface RetentionPlan {
  readonly actions: readonly RetentionAction[];
  readonly kept: readonly { item: InventoryItem; reason: KeepReason }[];
  readonly unknown: readonly { item: InventoryItem; reason: string }[];
  readonly reclaimableBytes: number;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byId = (a: InventoryItem, b: InventoryItem) =>
  compare(a.kind, b.kind) || compare(a.id, b.id);

/** Newest first. Ties break on ID so equal inputs give equal plans. */
const byNewest = (a: InventoryItem, b: InventoryItem) =>
  compare(b.completedAt ?? "", a.completedAt ?? "") || compare(a.id, b.id);

const reclaimed = (action: RetentionAction) =>
  action.action === "prune-run-heavy"
    ? (action.item.heavyBytes ?? 0)
    : action.item.bytes;

export function planRetention(input: {
  items: readonly InventoryItem[];
  protections: Protections;
  policy: RetentionPolicy;
}): RetentionPlan {
  const { protections, policy } = input;
  const items = [...input.items].sort(byId);
  const actions: RetentionAction[] = [];
  const kept: { item: InventoryItem; reason: KeepReason }[] = [];
  const unknown: { item: InventoryItem; reason: string }[] = [];
  const keptRuns = new Set<string>();

  const isProtected = (item: InventoryItem) =>
    (item.kind === "release"
      ? protections.releases
      : item.kind === "verification-run"
        ? protections.runs
        : protections.images
    ).includes(item.id);

  const choose = (
    kind: "release" | "verification-run",
    keep: number,
    action: RetentionActionKind,
  ) => {
    const candidates: InventoryItem[] = [];
    for (const item of items.filter((entry) => entry.kind === kind)) {
      if (!item.owned) {
        unknown.push({ item, reason: item.unknownReason ?? "not owned" });
      } else if (isProtected(item)) {
        kept.push({ item, reason: "protected" });
      } else if (!item.completedAt) {
        kept.push({ item, reason: "incomplete" });
      } else if (kind === "verification-run" && (item.heavyBytes ?? 0) === 0) {
        // A pruned run keeps only receipts and does not use a heavy slot.
        kept.push({ item, reason: "already-pruned" });
      } else {
        candidates.push(item);
      }
    }
    const ranked = candidates.sort(byNewest);
    for (const item of ranked.slice(0, keep))
      kept.push({ item, reason: "recent" });
    // Oldest first, so an interrupted run removes the least useful history.
    for (const item of ranked.slice(keep).reverse())
      actions.push({ action, item });
  };

  choose("release", Math.max(0, policy.keepReleases), "delete-release");
  choose("verification-run", Math.max(0, policy.keepRuns), "prune-run-heavy");
  for (const entry of kept) {
    if (
      entry.item.kind === "verification-run" &&
      entry.reason !== "already-pruned"
    )
      keptRuns.add(entry.item.id);
  }
  const knownRuns = new Set(
    items
      .filter((i) => i.kind === "verification-run" && i.owned)
      .map((i) => i.id),
  );

  for (const item of items.filter((entry) => entry.kind === "docker-image")) {
    if (!item.owned || !item.runId || !knownRuns.has(item.runId)) {
      unknown.push({
        item,
        reason: item.unknownReason ?? "no owned verification run",
      });
    } else if (isProtected(item)) {
      kept.push({ item, reason: "protected" });
    } else if (item.inUse) {
      kept.push({ item, reason: "in-use" });
    } else if (keptRuns.has(item.runId)) {
      kept.push({ item, reason: "run-kept" });
    } else {
      actions.push({ action: "delete-image", item });
    }
  }

  const sortKept = [...kept].sort((a, b) => byId(a.item, b.item));
  return {
    actions,
    kept: sortKept,
    unknown,
    reclaimableBytes: actions.reduce(
      (sum, action) => sum + reclaimed(action),
      0,
    ),
  };
}

export interface SpaceRequirement {
  readonly label: string;
  readonly path: string;
  readonly requiredBytes: number;
}

export interface SpaceSample {
  readonly path: string;
  /** Filesystem identity, such as the stat device number. */
  readonly device: string;
  readonly availableBytes: number;
}

export interface SpaceShortfall {
  readonly device: string;
  readonly labels: readonly string[];
  readonly requiredBytes: number;
  readonly availableBytes: number;
  readonly missingBytes: number;
}

export interface PreflightResult {
  readonly ok: boolean;
  readonly shortfalls: readonly SpaceShortfall[];
}

/** Requirements on one filesystem add up. A path with no sample fails closed. */
export function planPreflight(
  requirements: readonly SpaceRequirement[],
  samples: readonly SpaceSample[],
): PreflightResult {
  const groups = new Map<
    string,
    { labels: string[]; requiredBytes: number; availableBytes: number }
  >();
  const shortfalls: SpaceShortfall[] = [];
  for (const requirement of requirements) {
    const sample = samples.find((entry) => entry.path === requirement.path);
    if (!sample) {
      shortfalls.push({
        device: `unmeasured:${requirement.path}`,
        labels: [requirement.label],
        requiredBytes: requirement.requiredBytes,
        availableBytes: 0,
        missingBytes: requirement.requiredBytes,
      });
      continue;
    }
    const group = groups.get(sample.device) ?? {
      labels: [],
      requiredBytes: 0,
      availableBytes: sample.availableBytes,
    };
    group.labels.push(requirement.label);
    group.requiredBytes += requirement.requiredBytes;
    group.availableBytes = Math.min(
      group.availableBytes,
      sample.availableBytes,
    );
    groups.set(sample.device, group);
  }
  for (const [device, group] of groups) {
    if (group.availableBytes < group.requiredBytes) {
      shortfalls.push({
        device,
        labels: group.labels,
        requiredBytes: group.requiredBytes,
        availableBytes: group.availableBytes,
        missingBytes: group.requiredBytes - group.availableBytes,
      });
    }
  }
  return { ok: shortfalls.length === 0, shortfalls };
}

/** Extraction, pnpm store and node_modules for one release, plus fixed headroom. */
export function installRequiredBytes(uncompressedBytes: number): number {
  return 3 * uncompressedBytes + 2 * GIB;
}

/** Root floor from the native staging guard. Never lower it. */
export const VERIFICATION_ROOT_FLOOR_BYTES = 8 * GIB;
/** Data headroom from the native staging guard. */
export const VERIFICATION_DATA_HEADROOM_BYTES = 4 * GIB;

export function verificationRequirements(input: {
  rootPath: string;
  runsRoot: string;
  dataRoot: string;
  buildBytes: number;
  dataBytes: number;
}): SpaceRequirement[] {
  return [
    {
      label: "root floor",
      path: input.rootPath,
      requiredBytes: VERIFICATION_ROOT_FLOOR_BYTES,
    },
    {
      label: "build workspace",
      path: input.runsRoot,
      requiredBytes: input.buildBytes,
    },
    {
      label: "fixture data",
      path: input.dataRoot,
      requiredBytes: input.dataBytes + VERIFICATION_DATA_HEADROOM_BYTES,
    },
  ];
}

const RELEASE_NAME = /^[A-Za-z0-9.+-]+$/;

export type PointerResult =
  | { ok: true; version: string }
  | { ok: false; reason: string };

/** Accepts only `releases/<version>` link text. Anything else fails closed. */
export function parseReleasePointer(text: string): PointerResult {
  const match = /^releases\/([^/]+)$/.exec(text);
  const version = match?.[1];
  if (!version || !RELEASE_NAME.test(version) || /^\.+$/.test(version)) {
    return {
      ok: false,
      reason: `Invalid release pointer: ${JSON.stringify(text)}`,
    };
  }
  return { ok: true, version };
}

export function isReleaseName(name: string): boolean {
  return RELEASE_NAME.test(name) && !/^\.+$/.test(name);
}

/** True when `child` equals `parent` or lies below it. Both must be canonical. */
export function pathInside(child: string, parent: string): boolean {
  const base = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return child === base || child.startsWith(`${base}/`);
}

// Verification run lifecycle. The staging driver writes the owner record
// after it takes the run lease and before any heavy work.

export const RUN_STATES = [
  "staging",
  "staged",
  "executing",
  "completed",
  "failed",
] as const;

/** A staged run waits this long for its proof before it counts as abandoned. */
export const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

export type RunClass =
  | { readonly kind: "active" | "staged"; readonly protected: true }
  | {
      readonly kind: "terminal" | "abandoned";
      readonly protected: false;
      readonly completedAt: string;
    }
  | { readonly kind: "invalid"; readonly reason: string };

const isoTime = (value: unknown): string | null =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

/**
 * Classifies one owned run. A held lease always protects. A run left in a
 * working state with a free lease lost its process and becomes abandoned.
 */
export function classifyRun(input: {
  readonly state: unknown;
  readonly startedAt: unknown;
  readonly stagedAt: unknown;
  readonly completedAt: unknown;
  readonly leaseBusy: boolean;
  readonly now: string;
  readonly stagedTtlMs: number;
}): RunClass {
  const state = input.state;
  if (
    typeof state !== "string" ||
    !(RUN_STATES as readonly string[]).includes(state)
  )
    return { kind: "invalid", reason: "unknown run state" };
  if (input.leaseBusy) return { kind: "active", protected: true };
  if (state === "completed" || state === "failed") {
    const completedAt = isoTime(input.completedAt);
    return completedAt
      ? { kind: "terminal", protected: false, completedAt }
      : { kind: "invalid", reason: "finished run has no completion time" };
  }
  if (state === "staged") {
    const stagedAt = isoTime(input.stagedAt);
    if (!stagedAt) return { kind: "invalid", reason: "staged run has no time" };
    return Date.parse(input.now) - Date.parse(stagedAt) < input.stagedTtlMs
      ? { kind: "staged", protected: true }
      : { kind: "abandoned", protected: false, completedAt: stagedAt };
  }
  const startedAt = isoTime(input.startedAt);
  return startedAt
    ? { kind: "abandoned", protected: false, completedAt: startedAt }
    : { kind: "invalid", reason: "working run has no start time" };
}

// Running service identity. Mirrors rollback-release.sh: the unit MainPID must
// run `node RELEASE/dist/cli.js server start --foreground` from a canonical path.

/** Unit states in which a service process should exist. */
export const SERVICE_BUSY_STATES = [
  "active",
  "activating",
  "reloading",
  "refreshing",
  "deactivating",
] as const;

/** Environment names whose values are configured paths. Every other name is ignored. */
export const SERVICE_PATH_VARIABLES = [
  "HOME",
  "GWRK_HOME",
  "GWRK_DIR",
  "GWRK_DB_PATH",
  "GWRK_RUNTIME_DIR",
  "GWRK_SECRETS_DIR",
  "GWRK_PILOT_REPO",
  "GWRK_AGENT_CREDENTIAL_FILE",
  "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
  "GWRK_AUTH_CSRF_HMAC_FILE",
] as const;

export function parseSystemdShow(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0)
      fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
}

/** Absolute paths a unit declares for its state, runtime, secrets and work. */
export function unitConfiguredPaths(fields: Record<string, string>): string[] {
  const paths: string[] = [];
  const add = (raw: string) => {
    const path = raw.replace(/^[-+!]+/, "").split(":")[0] ?? "";
    if (path.startsWith("/")) paths.push(path);
  };
  add(fields.WorkingDirectory ?? "");
  for (const key of ["ReadWritePaths", "ReadOnlyPaths"])
    for (const entry of (fields[key] ?? "").split(/\s+/)) add(entry);
  for (const [key, prefix] of [
    ["StateDirectory", "/var/lib"],
    ["RuntimeDirectory", "/run"],
  ] as const)
    for (const name of (fields[key] ?? "").split(/\s+/))
      if (/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(name))
        paths.push(`${prefix}/${name}`);
  return paths;
}

export function environmentPaths(entries: readonly string[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (
      (SERVICE_PATH_VARIABLES as readonly string[]).includes(name) &&
      value.startsWith("/")
    )
      paths.push(value);
  }
  return paths;
}

export type LaunchIdentity =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false };

/** Never echoes the process arguments. They can carry secrets. */
export function identifyLaunch(
  argv: readonly string[],
  cliRealpath: string | null,
  releasesDir: string,
): LaunchIdentity {
  const [node, cli, server, start, foreground, ...rest] = argv;
  if (
    rest.length > 0 ||
    !(node === "node" || node?.endsWith("/node")) ||
    server !== "server" ||
    start !== "start" ||
    foreground !== "--foreground" ||
    !cli ||
    cli !== cliRealpath ||
    !pathInside(cli, releasesDir)
  )
    return { ok: false };
  const tail = cli.slice(releasesDir.length + 1).split("/");
  const [version, dist, file] = tail;
  if (
    tail.length !== 3 ||
    !version ||
    !isReleaseName(version) ||
    dist !== "dist" ||
    file !== "cli.js"
  )
    return { ok: false };
  return { ok: true, version };
}
