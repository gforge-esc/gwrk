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
