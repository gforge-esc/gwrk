/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Docker verification cache adapter. The removable class is narrow: images an
// owned run record names, tagged only in that run's namespace, labelled for
// that run and referenced by no container. Production, gateway and upstream
// images never qualify, so no protected-image list exists. Deletion targets the
// host image ID that `docker image inspect` reports. Docker 29 reports the OCI
// manifest digest there, which differs from the archive config digest. The
// archive config digest is proof evidence only and is never inspected or removed.

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { STAGED_TTL_MS, classifyRun } from "../../domain/retention-policy.js";
import type {
  InventoryItem,
  Protections,
  RetentionAction,
} from "../../domain/retention-policy.js";
import type {
  RetentionEffectsPort,
  RetentionInventoryPort,
} from "../../ports/retention-port.js";
import { acquireFlockLease } from "./retention-lock.js";
import { RUN_OWNER_FILE } from "./retention-verification.js";

const HOST_ID = /^sha256:[a-f0-9]{64}$/;
const RUN_ID = /^[a-f0-9]{24}$/;
export const VERIFICATION_REPOSITORY = "gwrk-verification";
export const MANAGED_LABEL = "org.gwrk.managed";
export const RUN_LABEL = "org.gwrk.run";

/** True only for `gwrk-verification:<runId>-<suffix>`. */
export function isRunTag(tag: unknown, runId: string): tag is string {
  return (
    typeof tag === "string" &&
    tag.startsWith(`${VERIFICATION_REPOSITORY}:${runId}-`) &&
    /^[a-z0-9][a-z0-9-]{0,63}$/.test(
      tag.slice(VERIFICATION_REPOSITORY.length + runId.length + 2),
    )
  );
}

export type DockerRunner = (
  args: readonly string[],
) => Promise<{ code: number; stdout: string }>;

export interface DockerImageDeps {
  readonly acquireLease?: (
    path: string,
  ) => Promise<(() => Promise<void>) | null>;
  readonly now?: () => string;
  readonly docker: DockerRunner;
}

interface ImageInfo {
  Id?: string;
  RepoTags?: string[] | null;
  Size?: number;
  Config?: { Labels?: Record<string, string> | null };
}

export function createDockerImageAdapter(
  runsRoot: string,
  deps: DockerImageDeps,
): RetentionInventoryPort & RetentionEffectsPort {
  async function inspect(ref: string): Promise<ImageInfo | null> {
    const result = await deps.docker([
      "image",
      "inspect",
      "--format",
      "{{json .}}",
      ref,
    ]);
    if (result.code !== 0) return null;
    return JSON.parse(result.stdout) as ImageInfo;
  }

  /** Every image any container references, running or stopped. */
  async function containerImages(): Promise<Set<string>> {
    const listed = await deps.docker(["ps", "-a", "-q", "--no-trunc"]);
    if (listed.code !== 0)
      throw new Error("Could not list Docker containers. Retention stopped.");
    const ids = listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (ids.length === 0) return new Set();
    const images = await deps.docker([
      "container",
      "inspect",
      "--format",
      "{{.Image}}",
      ...ids,
    ]);
    if (images.code !== 0)
      throw new Error(
        "Could not inspect Docker containers. Retention stopped.",
      );
    return new Set(
      images.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  function unknown(
    id: string,
    runId: string,
    reason: string,
    bytes = 0,
  ): InventoryItem {
    return {
      kind: "docker-image",
      id,
      runId,
      owned: false,
      unknownReason: reason,
      identity: "",
      bytes,
    };
  }

  function judge(
    info: ImageInfo,
    runId: string,
    inUse: Set<string>,
  ): InventoryItem {
    const hostId = info.Id ?? "";
    const bytes = info.Size ?? 0;
    if (!HOST_ID.test(hostId))
      return unknown(
        hostId || "(no ID)",
        runId,
        "invalid host image ID",
        bytes,
      );
    const tags = [...(info.RepoTags ?? [])].sort();
    if (tags.some((tag) => !isRunTag(tag, runId)))
      return unknown(hostId, runId, "foreign tag", bytes);
    const labels = info.Config?.Labels ?? {};
    if (labels[MANAGED_LABEL] !== "verification" || labels[RUN_LABEL] !== runId)
      return unknown(hostId, runId, "foreign label", bytes);
    return {
      kind: "docker-image",
      id: hostId,
      runId,
      owned: true,
      inUse: inUse.has(hostId),
      bytes,
      identity: createHash("sha256")
        .update(`${hostId}\n${runId}\n${tags.join(",")}`)
        .digest("hex"),
    };
  }

  async function describe(
    entry: { tag?: unknown; hostImageId?: unknown },
    runId: string,
    inUse: Set<string>,
  ): Promise<InventoryItem | null> {
    if (!isRunTag(entry.tag, runId))
      return unknown(
        String(entry.tag ?? "(missing tag)"),
        runId,
        "tag outside run namespace",
      );
    const host = entry.hostImageId;
    if (host !== undefined && (typeof host !== "string" || !HOST_ID.test(host)))
      return unknown(entry.tag, runId, "invalid host image ID");
    const info = await inspect(host ?? entry.tag);
    if (!info) return null;
    if (host !== undefined && info.Id !== host)
      return unknown(
        entry.tag,
        runId,
        "host identity mismatch",
        info.Size ?? 0,
      );
    return judge(info, runId, inUse);
  }

  async function readRecord(runId: string): Promise<unknown[] | null> {
    const marker = join(runsRoot, runId, RUN_OWNER_FILE);
    try {
      if (!(await lstat(join(runsRoot, runId))).isDirectory()) return null;
      if (!(await lstat(marker)).isFile()) return null;
      const parsed = JSON.parse(await readFile(marker, "utf8"));
      return parsed.schema === 1 &&
        parsed.runId === runId &&
        Array.isArray(parsed.images)
        ? parsed.images
        : null;
    } catch {
      return null;
    }
  }

  return {
    async inventory() {
      const inUse = await containerImages();
      const items: InventoryItem[] = [];
      const seen = new Set<string>();
      for (const runId of (await readdir(runsRoot)).sort()) {
        if (!RUN_ID.test(runId)) continue;
        const images = await readRecord(runId);
        for (const image of images ?? []) {
          if (!image || typeof image !== "object") continue;
          const item = await describe(
            image as Record<string, unknown>,
            runId,
            inUse,
          );
          if (!item || seen.has(`${item.id}\n${item.unknownReason ?? ""}`))
            continue;
          seen.add(`${item.id}\n${item.unknownReason ?? ""}`);
          items.push(item);
        }
      }
      return items;
    },

    async reidentify(item) {
      if (!item.runId || !HOST_ID.test(item.id)) return null;
      const info = await inspect(item.id);
      if (!info || info.Id !== item.id) return null;
      const fresh = judge(info, item.runId, await containerImages());
      return fresh.owned && !fresh.inUse ? fresh.identity : null;
    },

    async readProtections(): Promise<Protections> {
      return {
        releases: [],
        runs: [],
        images: [...(await containerImages())].sort(),
      };
    },

    async recoverQuarantine() {
      return { recovered: [], preserved: [] };
    },

    async apply(action: RetentionAction) {
      if (action.action !== "delete-image" || !HOST_ID.test(action.item.id))
        throw new Error(
          `Unsupported action ${action.action} for Docker images.`,
        );
      const runId = action.item.runId;
      if (!runId || !RUN_ID.test(runId))
        throw new Error("Missing owned image run.");
      const release = await (deps.acquireLease ?? acquireFlockLease)(
        join(runsRoot, runId, ".lease"),
      );
      if (!release) throw new Error("Image run became active before cleanup.");
      try {
        const marker = join(runsRoot, runId, RUN_OWNER_FILE);
        if (!(await lstat(marker)).isFile())
          throw new Error("Image owner record changed.");
        const record = JSON.parse(await readFile(marker, "utf8"));
        const state = classifyRun({
          state: record.state,
          startedAt: record.startedAt,
          stagedAt: record.stagedAt,
          completedAt: record.completedAt,
          stagedTtlMs: STAGED_TTL_MS,
          leaseBusy: false,
          now: (deps.now ?? (() => new Date().toISOString()))(),
        });
        if (
          record.schema !== 1 ||
          record.runId !== runId ||
          state.kind === "invalid" ||
          state.protected
        )
          throw new Error("Image run is no longer eligible.");
        const images = await readRecord(runId);
        const info = await inspect(action.item.id);
        const fresh = info ? judge(info, runId, await containerImages()) : null;
        if (
          !fresh?.owned ||
          fresh.inUse ||
          fresh.identity !== action.item.identity ||
          !images?.some(
            (entry) =>
              entry &&
              typeof entry === "object" &&
              ((entry as Record<string, unknown>).hostImageId ===
                action.item.id ||
                info?.RepoTags?.includes(
                  String((entry as Record<string, unknown>).tag),
                )),
          )
        )
          throw new Error(
            "Image ownership or references changed before cleanup.",
          );
        const result = await deps.docker(["image", "rm", action.item.id]);
        if (result.code !== 0) throw new Error("Owned image removal failed.");
      } finally {
        await release();
      }
    },
  };
}

/** Merges inventory and protections. Routes each action to the port that owns its kind. */
export function combineRetentionPorts(
  parts: readonly {
    kinds: readonly InventoryItem["kind"][];
    port: RetentionInventoryPort & RetentionEffectsPort;
  }[],
): RetentionInventoryPort & RetentionEffectsPort {
  const owner = (kind: InventoryItem["kind"]) => {
    const part = parts.find((entry) => entry.kinds.includes(kind));
    if (!part) throw new Error(`No retention port owns ${kind}.`);
    return part.port;
  };
  return {
    async inventory() {
      const all: InventoryItem[] = [];
      for (const part of parts) all.push(...(await part.port.inventory()));
      return all;
    },
    reidentify: (item) => owner(item.kind).reidentify(item),
    async readProtections() {
      const merged = {
        releases: [] as string[],
        runs: [] as string[],
        images: [] as string[],
      };
      for (const part of parts) {
        const p = await part.port.readProtections();
        merged.releases.push(...p.releases);
        merged.runs.push(...p.runs);
        merged.images.push(...p.images);
      }
      return merged;
    },
    async recoverQuarantine() {
      const recovered: string[] = [];
      const preserved: { name: string; reason: string }[] = [];
      for (const part of parts) {
        const result = await part.port.recoverQuarantine();
        recovered.push(...result.recovered);
        preserved.push(...result.preserved);
      }
      return { recovered, preserved };
    },
    apply: (action) => owner(action.item.kind).apply(action),
  };
}
