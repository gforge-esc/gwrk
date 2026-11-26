/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Lifecycle step: plan retention, recheck, delete owned items, then recheck
// free space. The caller holds the root lock for the whole step.

import {
  type InventoryItem,
  type PreflightResult,
  type RetentionActionKind,
  type RetentionPolicy,
  type SpaceRequirement,
  planPreflight,
  planRetention,
} from "../../domain/retention-policy.js";
import type {
  DiskSpacePort,
  RetentionEffectsPort,
  RetentionInventoryPort,
  RetentionReceiptPort,
} from "../../ports/retention-port.js";

export interface RetentionStepInput {
  readonly inventory: RetentionInventoryPort;
  readonly effects: RetentionEffectsPort;
  readonly disk: DiskSpacePort;
  readonly receipts: RetentionReceiptPort;
  readonly policy: RetentionPolicy;
  readonly requirements: readonly SpaceRequirement[];
  readonly now: () => string;
}

export interface RetentionStepResult {
  readonly ok: boolean;
  readonly message: string;
  readonly receiptPath: string;
  readonly deleted: {
    id: string;
    action: RetentionActionKind;
    bytes: number;
  }[];
  readonly skipped: { id: string; reason: string }[];
  readonly failed: { id: string; action: RetentionActionKind; error: string }[];
  readonly unknown: { id: string; reason: string; bytes: number }[];
  readonly retained: { id: string; reason: string; bytes: number }[];
  readonly preflight: PreflightResult | null;
}

const human = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${(bytes / 1024).toFixed(1)} KiB`;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function runRetentionStep(
  input: RetentionStepInput,
): Promise<RetentionStepResult> {
  const startedAt = input.now();
  const receiptName = `${startedAt.replace(/[^0-9TZ]/g, "")}-${process.pid}`;
  const deleted: RetentionStepResult["deleted"] = [];
  const skipped: RetentionStepResult["skipped"] = [];
  const failed: RetentionStepResult["failed"] = [];
  let unknown: RetentionStepResult["unknown"] = [];
  let retained: RetentionStepResult["retained"] = [];
  let preflight: PreflightResult | null = null;

  const finish = async (ok: boolean, text: string) => {
    const result = {
      ok,
      message: text,
      deleted,
      skipped,
      failed,
      unknown,
      retained,
      preflight,
    };
    const receiptPath = await input.receipts.write(receiptName, {
      schema: 1,
      startedAt,
      finishedAt: input.now(),
      policy: input.policy,
      requirements: input.requirements,
      ...result,
    });
    return { ...result, receiptPath };
  };

  let plan: ReturnType<typeof planRetention>;
  try {
    await input.effects.sweepTrash();
    const [items, protections] = [
      await input.inventory.inventory(),
      await input.inventory.readProtections(),
    ];
    plan = planRetention({ items, protections, policy: input.policy });
  } catch (error) {
    return finish(
      false,
      `Retention stopped before deletion: ${message(error)}`,
    );
  }
  unknown = plan.unknown.map(({ item, reason }) => ({
    id: item.id,
    reason,
    bytes: item.bytes,
  }));
  retained = plan.kept.map(({ item, reason }) => ({
    id: item.id,
    reason,
    bytes: item.bytes,
  }));
  await input.receipts.write(receiptName, {
    schema: 1,
    startedAt,
    state: "planned",
    actions: plan.actions.map(({ action, item }) => ({ action, id: item.id })),
  });

  for (const { action, item } of plan.actions) {
    try {
      const protections = await input.inventory.readProtections();
      if (isNowProtected(item, protections)) {
        skipped.push({ id: item.id, reason: "protected after planning" });
        continue;
      }
      if ((await input.inventory.reidentify(item)) !== item.identity) {
        skipped.push({
          id: item.id,
          reason: "identity changed after planning",
        });
        continue;
      }
      await input.effects.apply({ action, item });
      deleted.push({
        id: item.id,
        action,
        bytes:
          action === "prune-run-heavy" ? (item.heavyBytes ?? 0) : item.bytes,
      });
    } catch (error) {
      failed.push({ id: item.id, action, error: message(error) });
    }
  }

  try {
    preflight = planPreflight(
      input.requirements,
      await input.disk.sample(input.requirements.map((r) => r.path)),
    );
  } catch (error) {
    return finish(
      false,
      `Disk preflight could not measure space: ${message(error)}`,
    );
  }
  if (preflight.ok) return finish(true, "Retention and disk preflight passed.");

  const short = preflight.shortfalls
    .map(
      (s) =>
        `${s.labels.join(" + ")} on ${s.device}: need ${human(s.requiredBytes)}, have ${human(s.availableBytes)}, missing ${human(s.missingBytes)}`,
    )
    .join("; ");
  const kept = retained
    .map((r) => `${r.id} (${r.reason}, ${human(r.bytes)})`)
    .join(", ");
  const foreign = unknown
    .map((u) => `${u.id} (${u.reason}, ${human(u.bytes)})`)
    .join(", ");
  return finish(
    false,
    [
      `Not enough free space after retention. ${short}.`,
      `Retained: ${kept || "none"}.`,
      `Unknown, never deleted: ${foreign || "none"}.`,
      "Free space outside gwrk-owned artifacts or adopt unknown items, then retry.",
    ].join(" "),
  );
}

function isNowProtected(
  item: InventoryItem,
  protections: {
    releases: readonly string[];
    runs: readonly string[];
    images: readonly string[];
  },
): boolean {
  const list =
    item.kind === "release"
      ? protections.releases
      : item.kind === "verification-run"
        ? protections.runs
        : protections.images;
  return list.includes(item.id);
}
