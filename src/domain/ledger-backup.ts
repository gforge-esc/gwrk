/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

export const PENDING_LEDGER_RESTORE = ".restore-pending";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonnegative = z.number().int().nonnegative();
const ledgerSummary = z
  .object({
    migrations: z.array(z.string()),
    projectIds: z.array(z.string()),
    completedRunIds: z.array(nonnegative),
    compressionCount: nonnegative,
    historyCount: nonnegative,
    enrolledRepoDigests: z.record(digest),
  })
  .strict();

export const LedgerBackupManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    createdAt: z.string().datetime(),
    gwrkVersion: z.string().min(1),
    dbSha256: digest,
    metadataSha256: digest,
    summary: ledgerSummary,
  })
  .strict();

export const LedgerBackupMetadataSchema = z
  .object({
    device: z
      .object({
        id: z.string().min(1),
        hostname: z.string(),
        role: z.enum(["server", "remote"]),
        createdAt: z.string(),
      })
      .strict()
      .nullable(),
    repositories: z.array(
      z
        .object({
          projectId: z.string().min(1),
          root: z.string().min(1),
          remote: z.string().nullable(),
          head: z
            .string()
            .regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/)
            .nullable(),
          evidence: z.array(
            z.object({ path: z.string().min(1), sha256: digest }).strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export type LedgerSummary = z.output<typeof ledgerSummary>;
export type LedgerBackupManifest = z.output<typeof LedgerBackupManifestSchema>;
export type LedgerBackupMetadata = z.output<typeof LedgerBackupMetadataSchema>;
