/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Docker image retention adapter. Lists only config IDs that an owned run
// manifest names, checks labels, and removes without force. No prune.

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  InventoryItem,
  Protections,
  RetentionAction,
} from "../../domain/retention-policy.js";
import type {
  RetentionEffectsPort,
  RetentionInventoryPort,
} from "../../ports/retention-port.js";
import { RUN_OWNER_FILE } from "./retention-verification.js";

const CONFIG_ID = /^sha256:[a-f0-9]{64}$/;

export type DockerRunner = (
  args: readonly string[],
) => Promise<{ code: number; stdout: string }>;

export interface DockerImageDeps {
  readonly docker: DockerRunner;
  /** JSON array of protected config IDs, such as live gateway images. */
  readonly protectedImagesFile: string;
}

interface ImageInfo {
  Id?: string;
  Size?: number;
  Config?: { Labels?: Record<string, string> | null };
}

export function createDockerImageAdapter(
  runsRoot: string,
  deps: DockerImageDeps,
): RetentionInventoryPort & RetentionEffectsPort {
  async function inspect(configId: string): Promise<ImageInfo | null> {
    const result = await deps.docker([
      "image",
      "inspect",
      "--format",
      "{{json .}}",
      configId,
    ]);
    if (result.code !== 0) return null;
    return JSON.parse(result.stdout) as ImageInfo;
  }

  async function describe(
    configId: string,
    runId: string,
  ): Promise<InventoryItem | null> {
    const info = await inspect(configId);
    if (!info) return null;
    const labels = info.Config?.Labels ?? {};
    const base = {
      kind: "docker-image" as const,
      id: configId,
      runId,
      bytes: info.Size ?? 0,
    };
    // Docker 29 reports manifest digests that differ from config IDs. Trust only the config ID.
    if (info.Id !== configId)
      return {
        ...base,
        owned: false,
        unknownReason: "config ID mismatch",
        identity: "",
      };
    if (
      labels["org.gwrk.managed"] !== "verification" ||
      labels["org.gwrk.run"] !== runId
    )
      return {
        ...base,
        owned: false,
        unknownReason: "foreign label",
        identity: "",
      };
    const users = await deps.docker([
      "ps",
      "-a",
      "-q",
      "--no-trunc",
      "--filter",
      `ancestor=${configId}`,
    ]);
    if (users.code !== 0)
      throw new Error(`Could not list containers for ${configId}.`);
    return {
      ...base,
      owned: true,
      inUse: users.stdout.trim() !== "",
      identity: createHash("sha256")
        .update(`${configId}\n${runId}`)
        .digest("hex"),
    };
  }

  return {
    async inventory() {
      const items: InventoryItem[] = [];
      for (const runId of (await readdir(runsRoot)).sort()) {
        const marker = join(runsRoot, runId, RUN_OWNER_FILE);
        let parsed: { runId?: unknown; images?: unknown };
        try {
          if (!(await lstat(marker)).isFile()) continue;
          parsed = JSON.parse(await readFile(marker, "utf8"));
        } catch {
          continue;
        }
        if (parsed.runId !== runId || !Array.isArray(parsed.images)) continue;
        for (const image of parsed.images as { configId?: unknown }[]) {
          if (
            typeof image?.configId !== "string" ||
            !CONFIG_ID.test(image.configId)
          )
            continue;
          const item = await describe(image.configId, runId);
          if (item) items.push(item);
        }
      }
      return items;
    },

    async reidentify(item) {
      if (!item.runId) return null;
      const fresh = await describe(item.id, item.runId);
      return fresh?.owned && !fresh.inUse ? fresh.identity : null;
    },

    async readProtections(): Promise<Protections> {
      const list = JSON.parse(await readFile(deps.protectedImagesFile, "utf8"));
      if (
        !Array.isArray(list) ||
        !list.every((id) => typeof id === "string" && CONFIG_ID.test(id))
      )
        throw new Error(
          `Protected image list ${deps.protectedImagesFile} is invalid.`,
        );
      return { releases: [], runs: [], images: [...list].sort() };
    },

    async sweepTrash() {
      return [];
    },

    async apply(action: RetentionAction) {
      if (action.action !== "delete-image")
        throw new Error(
          `Unsupported action ${action.action} for Docker images.`,
        );
      const result = await deps.docker(["image", "rm", action.item.id]);
      if (result.code !== 0)
        throw new Error(`docker image rm ${action.item.id} failed.`);
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
    async sweepTrash() {
      const removed: string[] = [];
      for (const part of parts) removed.push(...(await part.port.sweepTrash()));
      return removed;
    },
    apply: (action) => owner(action.item.kind).apply(action),
  };
}
