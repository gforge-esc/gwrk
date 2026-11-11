/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { posix } from "node:path";
import { z } from "zod";

const version = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/,
  );
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version,
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    builtAt: z.string().datetime(),
    nodeVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .refine(
        (nodeVersion) => Number(nodeVersion.split(".")[0]) >= 22,
        "The Linux runner requires Node.js 22 or newer",
      ),
    nodeAbi: z.string().regex(/^[1-9]\d*$/),
    platform: z.literal("linux"),
    arch: z.enum(["x64", "arm64"]),
    tarballSha256: sha256,
    lockfileSha256: sha256,
    plugins: z
      .array(
        z
          .object({
            kind: z.enum([
              "agent",
              "channel",
              "extension",
              "review",
              "skill",
              "workflow",
            ]),
            name: z.string().regex(/^[a-z][a-z0-9-]*$/),
            version,
          })
          .strict(),
      )
      .readonly(),
    migrations: z
      .array(
        z
          .object({
            name: z.string().regex(/^[0-9]{3,}[-_][a-z0-9_-]+\.sql$/),
            sha256,
          })
          .strict(),
      )
      .readonly(),
  })
  .strict()
  .superRefine(({ plugins, migrations }, context) => {
    const pluginIds = new Set(
      plugins.map(({ kind, name }) => `${kind}:${name}`),
    );
    if (pluginIds.size !== plugins.length) {
      context.addIssue({
        code: "custom",
        path: ["plugins"],
        message: "Duplicate plugin identity",
      });
    }
    if (
      new Set(migrations.map(({ name }) => name)).size !== migrations.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["migrations"],
        message: "Duplicate migration name",
      });
    }
  });

export type ReleaseManifest = Readonly<z.output<typeof manifestSchema>>;

export interface RunnerLayout {
  readonly releaseRoot: string;
  readonly stateRoot: string;
  readonly runtimeRoot: string;
  readonly secretsRoot: string;
  readonly listenHost: string;
  readonly listenPort: number;
  readonly telegramEnabled: boolean;
  readonly credentialPaths: readonly string[];
}

export type ValidationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export type RollbackCompatibility =
  | { readonly allowed: true; readonly targetVersion: string }
  | {
      readonly allowed: false;
      readonly targetVersion: string;
      readonly blockingMigrations: readonly string[];
    };

export function validateReleaseManifest(
  input: unknown,
): ValidationOutcome<ReleaseManifest> {
  const result = manifestSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : {
        ok: false,
        errors: result.error.issues.map(
          ({ path, message }) => `${path.join(".") || "manifest"}: ${message}`,
        ),
      };
}

function isCanonicalPath(value: string): boolean {
  return (
    value !== "/" &&
    posix.isAbsolute(value) &&
    !value.includes("\0") &&
    !value.endsWith("/") &&
    posix.normalize(value) === value
  );
}

function containsPath(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function isPrivateBind(host: string): boolean {
  if (host === "127.0.0.1" || host === "::1") return true;
  const segments = host.split(".");
  if (
    segments.length !== 4 ||
    segments.some(
      (segment) => !/^(0|[1-9]\d{0,2})$/.test(segment) || Number(segment) > 255,
    )
  )
    return false;

  const [a, b] = segments.map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function validateRunnerLayout(
  layout: RunnerLayout,
  disallowedHomes: readonly string[],
): ValidationOutcome<RunnerLayout> {
  const errors: string[] = [];
  const roots = [
    ["releaseRoot", layout.releaseRoot],
    ["stateRoot", layout.stateRoot],
    ["runtimeRoot", layout.runtimeRoot],
    ["secretsRoot", layout.secretsRoot],
  ] as const;
  const homes = disallowedHomes.map((home) =>
    posix.normalize(home).replace(/\/$/, ""),
  );
  for (const [index, [name, root]] of roots.entries()) {
    if (!isCanonicalPath(root)) {
      errors.push(`${name} must be a canonical absolute Linux path`);
    }
    if (homes.some((home) => containsPath(home, root))) {
      errors.push(`${name} must be outside the operator's local home`);
    }
    for (const [otherName, other] of roots.slice(index + 1)) {
      if (containsPath(root, other) || containsPath(other, root)) {
        errors.push(`${name} overlaps ${otherName}`);
      }
    }
  }

  if (
    layout.credentialPaths.some(
      (credential) =>
        !isCanonicalPath(credential) ||
        credential === layout.secretsRoot ||
        !containsPath(layout.secretsRoot, credential),
    )
  ) {
    errors.push("Credential files must be inside the secrets directory");
  }
  if (!isPrivateBind(layout.listenHost)) {
    errors.push("The server must bind to loopback or a private IPv4 address");
  }
  if (
    !Number.isInteger(layout.listenPort) ||
    layout.listenPort < 1 ||
    layout.listenPort > 65_535
  ) {
    errors.push("The server port must be between 1 and 65535");
  }
  if (layout.telegramEnabled)
    errors.push("Telegram must be disabled for the pilot");

  return errors.length ? { ok: false, errors } : { ok: true, value: layout };
}

export function evaluateRollbackCompatibility(
  appliedMigrations: readonly string[],
  current: ReleaseManifest,
  target: ReleaseManifest,
): RollbackCompatibility {
  const appliedDigests = new Map(
    current.migrations.map(({ name, sha256 }) => [name, sha256]),
  );
  const targetDigests = new Map(
    target.migrations.map(({ name, sha256 }) => [name, sha256]),
  );
  const applied = new Set(appliedMigrations);
  const blockingMigrations = [
    ...[...applied].filter(
      (name) =>
        !appliedDigests.has(name) ||
        appliedDigests.get(name) !== targetDigests.get(name),
    ),
    ...[...targetDigests.keys()].filter((name) => !applied.has(name)),
  ];
  return blockingMigrations.length
    ? { allowed: false, targetVersion: target.version, blockingMigrations }
    : { allowed: true, targetVersion: target.version };
}
