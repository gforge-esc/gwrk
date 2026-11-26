/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  InventoryItem,
  Protections,
  RetentionAction,
  SpaceSample,
} from "../domain/retention-policy.js";

/** Lists candidate artifacts in one canonical root. Never follows symlinks. */
export interface RetentionInventoryPort {
  inventory(): Promise<InventoryItem[]>;
  /** Fresh identity hash, or null when the item is gone or changed type. */
  reidentify(item: InventoryItem): Promise<string | null>;
  /** Throws when a pointer or lease is ambiguous. Callers fail closed. */
  readProtections(): Promise<Protections>;
}

export interface RetentionEffectsPort {
  /** Removes crash leftovers that this root owns. Returns removed names. */
  sweepTrash(): Promise<string[]>;
  apply(action: RetentionAction): Promise<void>;
}

export interface DiskSpacePort {
  sample(paths: readonly string[]): Promise<SpaceSample[]>;
}

export interface RetentionReceiptPort {
  write(name: string, receipt: unknown): Promise<string>;
}
