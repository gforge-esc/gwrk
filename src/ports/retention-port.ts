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
  /** Throws when a pointer, lease or running service is ambiguous. Callers fail closed. */
  readProtections(): Promise<Protections>;
}

export interface QuarantineRecovery {
  /** Interrupted quarantines that matched their intent and identity, then were removed. */
  readonly recovered: string[];
  /** Entries left in place, such as unknown names or changed identities. */
  readonly preserved: { name: string; reason: string }[];
}

export interface RetentionEffectsPort {
  /** Finishes interrupted deletions this root positively owns. Never removes unknown entries. */
  recoverQuarantine(): Promise<QuarantineRecovery>;
  apply(action: RetentionAction): Promise<void>;
}

export interface DiskSpacePort {
  sample(paths: readonly string[]): Promise<SpaceSample[]>;
}

export interface RetentionReceiptPort {
  write(name: string, receipt: unknown): Promise<string>;
}

/** The gwrk service as the host runs it now. */
export interface RunningService {
  /** Release versions that running service processes execute. */
  readonly releases: readonly string[];
  /** Absolute state, secret, project and backup paths the service is configured with. */
  readonly configuredPaths: readonly string[];
}

export interface RunningServicePort {
  /** Throws when the running service identity is ambiguous. Callers fail closed. */
  discover(): Promise<RunningService>;
}

export interface LockProofPort {
  /** Throws unless this process holds the root's exclusive lock. */
  assertHeld(): Promise<void>;
}
