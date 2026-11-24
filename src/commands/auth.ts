/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import {
  CredentialDeliveryError,
  CredentialNotFoundError,
  CredentialPolicyError,
  createApiCredential,
  listApiCredentials,
  revokeApiCredential,
  rotateApiCredential,
} from "../application/auth/manage-credentials.js";
import { openDatabase } from "../db/index.js";
import {
  type ProjectRole,
  ProjectRoleSchema,
} from "../domain/project-registry.js";
import type { ClockPort } from "../ports/operations-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";

const RAW_CREDENTIAL_LEAK_PATTERN =
  /\bgwrk_v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/;
const PUBLIC_CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resolveCommandOutput(
  options: { format?: string; json?: boolean },
  command: Command,
) {
  if (options.json) return createOutput("json");
  if (options.format) {
    return options.format === "text"
      ? createOutput(undefined)
      : createOutput(options.format);
  }
  return resolveFormat(command);
}

function systemClock(): ClockPort {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  };
}

function mapUseCaseError(err: unknown): never {
  if (err instanceof CommandError) throw err;
  if (err instanceof CredentialPolicyError) {
    throw new CommandError(err.message, 2);
  }
  if (err instanceof CredentialNotFoundError) {
    throw new CommandError(err.message, 1);
  }
  if (err instanceof CredentialDeliveryError) {
    throw new CommandError(err.message, 1);
  }
  throw err;
}

function resolveAudienceOrigin(explicitOrigin?: string): string {
  const origin =
    explicitOrigin?.trim() || process.env.GWRK_AUTH_PUBLIC_ORIGIN?.trim() || "";
  if (origin.length === 0) {
    throw new CommandError(
      "Missing audience origin. Pass --origin <https-origin> or set GWRK_AUTH_PUBLIC_ORIGIN.",
      2,
    );
  }
  return origin;
}

function parseGrantFlag(raw: string): { projectId: string; role: ProjectRole } {
  const eqIndex = raw.lastIndexOf("=");
  if (eqIndex <= 0 || eqIndex === raw.length - 1) {
    throw new CommandError(
      `Invalid --grant '${raw}'. Expected '<project>=<role>' (for example alpha=operator). Run 'gwrk auth key create --help' for usage.`,
      2,
    );
  }
  const projectId = raw.slice(0, eqIndex).trim();
  const roleText = raw.slice(eqIndex + 1).trim();
  if (projectId.length === 0 || projectId === "*") {
    throw new CommandError(
      "Invalid --grant project. Wildcard grants are forbidden; pass an explicit enrolled project. Run 'gwrk project list' to see enrolled projects.",
      2,
    );
  }
  const parsedRole = ProjectRoleSchema.safeParse(roleText);
  if (!parsedRole.success) {
    throw new CommandError(
      `Invalid role '${roleText}' in --grant. Expected viewer, operator, or maintainer. Run 'gwrk auth key create --help' for usage.`,
      2,
    );
  }
  return { projectId, role: parsedRole.data };
}

function findGitTopLevel(directory: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: directory,
      env: repositoryGitEnv(directory),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
    return out ? fs.realpathSync(out) : null;
  } catch {
    return null;
  }
}

function isInsideDirectory(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function hasCheckoutMarkerInAncestors(directory: string): boolean {
  let current = directory;
  while (true) {
    if (
      fs.existsSync(path.join(current, ".git")) ||
      fs.existsSync(path.join(current, ".gwrkrc.json"))
    ) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function collectForbiddenCheckoutRoots(
  cwd: string,
  parentRealPath: string,
  registry: ProjectRegistryPort,
): string[] {
  const roots = new Set<string>();

  const cwdGit = findGitTopLevel(cwd);
  if (cwdGit) roots.add(cwdGit);

  const targetGit = findGitTopLevel(parentRealPath);
  if (targetGit) roots.add(targetGit);

  for (const project of registry.listProjects()) {
    for (const candidate of [project.localRoot, project.mirrorPath]) {
      if (!candidate) continue;
      try {
        roots.add(fs.realpathSync(candidate));
      } catch {
        roots.add(path.resolve(candidate));
      }
    }
  }

  return Array.from(roots);
}

function validateSecretOutPath(
  rawSecretOut: string,
  registry: ProjectRegistryPort,
): { displayPath: string; targetPath: string } {
  const trimmed = rawSecretOut.trim();
  if (trimmed.length === 0) {
    throw new CommandError(
      "Missing --secret-out <path>. Supply a new file path outside any repository checkout.",
      2,
    );
  }

  const resolvedPath = path.resolve(trimmed);

  // Reject any existing file, directory, or symlink (including dangling symlinks).
  try {
    const stat = fs.lstatSync(resolvedPath);
    if (stat.isSymbolicLink()) {
      throw new CommandError(
        `Refusing to write secret to symlink '${resolvedPath}'. Choose a new file path outside any repository checkout.`,
        2,
      );
    }
    throw new CommandError(
      `Refusing to overwrite existing path '${resolvedPath}'. Choose a new file path outside any repository checkout.`,
      2,
    );
  } catch (err: unknown) {
    if (err instanceof CommandError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new CommandError(
        `Cannot inspect --secret-out path '${resolvedPath}': ${(err as Error).message}. Choose a new file path outside any repository checkout.`,
        2,
      );
    }
  }

  const parentDir = path.dirname(resolvedPath);
  let parentRealPath: string;
  try {
    const parentStat = fs.statSync(parentDir);
    if (!parentStat.isDirectory()) {
      throw new CommandError(
        `Parent path '${parentDir}' is not a directory. Choose a new file path in an existing directory outside any repository checkout.`,
        2,
      );
    }
    parentRealPath = fs.realpathSync(parentDir);
  } catch (err: unknown) {
    if (err instanceof CommandError) throw err;
    throw new CommandError(
      `Parent directory '${parentDir}' does not exist or is inaccessible. Create a private directory outside any repository checkout first.`,
      2,
    );
  }

  const canonicalTarget = path.join(
    parentRealPath,
    path.basename(resolvedPath),
  );
  const forbiddenRoots = collectForbiddenCheckoutRoots(
    process.cwd(),
    parentRealPath,
    registry,
  );
  if (
    hasCheckoutMarkerInAncestors(parentRealPath) ||
    forbiddenRoots.some(
      (root) =>
        isInsideDirectory(canonicalTarget, root) ||
        isInsideDirectory(resolvedPath, root),
    )
  ) {
    throw new CommandError(
      `Refusing to write secret inside a repository checkout ('${resolvedPath}'). Choose a new file path outside any checkout.`,
      2,
    );
  }

  return { displayPath: resolvedPath, targetPath: canonicalTarget };
}

function writeSecretFileExclusive(
  targetPath: string,
  rawCredential: string,
): void {
  const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    noFollowFlag;
  const fd = fs.openSync(targetPath, flags, 0o600);
  let committed = false;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error("Secret output target is not a regular file");
    }
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${rawCredential}\n`, { encoding: "utf-8" });
    fs.fsyncSync(fd);
    committed = true;
  } finally {
    fs.closeSync(fd);
    if (!committed) {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        // Best-effort cleanup of partial secret file.
      }
    }
  }
}

function assertSafeOutputBuffer(
  payload: string | object,
  secretGuards: readonly string[] = [],
): void {
  const serialized =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  if (
    RAW_CREDENTIAL_LEAK_PATTERN.test(serialized) ||
    serialized.includes('"verifierSha256"')
  ) {
    throw new CommandError(
      "Output safety guard aborted emission: secret material detected in output buffer.",
      1,
    );
  }
  for (const guard of secretGuards) {
    if (guard.length > 0 && serialized.includes(guard)) {
      throw new CommandError(
        "Output safety guard aborted emission: raw secret detected in output buffer.",
        1,
      );
    }
  }
}

function assertValidPublicIdFlag(rawId: string): string {
  if (!PUBLIC_CREDENTIAL_ID_PATTERN.test(rawId)) {
    throw new CommandError(
      "Invalid credential ID. Pass a public credential ID (never a raw API key). Run 'gwrk auth key list' to inspect credential IDs.",
      2,
    );
  }
  return rawId;
}

interface KeyCreateOptions {
  grant: string[];
  expiresAt?: string;
  label?: string;
  secretOut?: string;
  origin?: string;
  issuer?: string;
  format?: string;
  json?: boolean;
}

const createAuthKeyCreateCommand = () =>
  new Command("create")
    .description(
      "Create a finite-expiry opaque API credential with explicit project role grants (mutator)",
    )
    .option(
      "--grant <project=role>",
      "Grant project access (<project>=<viewer|operator|maintainer>, repeatable)",
      collectOption,
      [] as string[],
    )
    .option("--expires-at <iso8601>", "Finite ISO-8601 expiry timestamp")
    .option("--label <text>", "Human-readable credential label")
    .option(
      "--secret-out <path>",
      "New owner-only (0600) output file outside any checkout",
    )
    .option(
      "--origin <url>",
      "Canonical HTTPS server origin audience (defaults to GWRK_AUTH_PUBLIC_ORIGIN)",
    )
    .option("--issuer <name>", "Issuer identifier", "local-admin")
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .allowExcessArguments(false)
    .addHelpText(
      "after",
      `
Type: mutator (persists verifier and role bindings; writes 0600 secret file)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success (stdout contains public metadata and secretOut path only)
  1: Persistence or secret delivery failure
  2: Usage, path, or policy validation error
`,
    )
    .action(async (options: KeyCreateOptions, command: Command) => {
      await withSignal("auth key create", async () => {
        const out = resolveCommandOutput(options, command);

        if (!options.grant || options.grant.length === 0) {
          throw new CommandError(
            "Missing required --grant <project>=<role>. Run 'gwrk auth key create --help' for usage.",
            2,
          );
        }
        if (!options.expiresAt) {
          throw new CommandError(
            "Missing required --expires-at <iso8601>. Run 'gwrk auth key create --help' for usage.",
            2,
          );
        }
        if (!options.label || options.label.trim().length === 0) {
          throw new CommandError(
            "Missing required --label <text>. Run 'gwrk auth key create --help' for usage.",
            2,
          );
        }
        if (!options.secretOut) {
          throw new CommandError(
            "Missing required --secret-out <path>. Run 'gwrk auth key create --help' for usage.",
            2,
          );
        }

        const audienceOrigin = resolveAudienceOrigin(options.origin);
        const parsedGrants = options.grant.map(parseGrantFlag);

        const db = openDatabase();
        try {
          const projectRegistry = createSqliteProjectRegistryAdapter({ db });
          const authStore = createSqliteAuthStoreAdapter({ db });
          const crypto = createCredentialCryptoAdapter();
          const secretTarget = validateSecretOutPath(
            options.secretOut,
            projectRegistry,
          );

          const emittedSecrets: string[] = [];
          const result = await createApiCredential(
            {
              authStore,
              grantAdmin: authStore,
              crypto,
              clock: systemClock(),
              projectRegistry,
              deliverSecret: async (rawCredential) => {
                emittedSecrets.push(rawCredential);
                const secretPart = rawCredential.split(".")[2];
                if (secretPart) emittedSecrets.push(secretPart);
                writeSecretFileExclusive(
                  secretTarget.targetPath,
                  rawCredential,
                );
              },
            },
            {
              label: options.label,
              issuer: options.issuer ?? "local-admin",
              audienceOrigin,
              expiresAt: options.expiresAt,
              grants: parsedGrants,
            },
          ).catch(mapUseCaseError);

          if (out.isJson) {
            const payload = {
              credential: result.credential,
              grants: result.grants,
              secretOut: secretTarget.displayPath,
            };
            assertSafeOutputBuffer(payload, emittedSecrets);
            out.write(payload);
            return;
          }

          const text = [
            `Created API credential: ${result.credential.credentialId}`,
            `  Label:      ${result.credential.label}`,
            `  Audience:   ${result.credential.audienceOrigin}`,
            `  ExpiresAt:  ${result.credential.expiresAt}`,
            `  Grants:     ${result.grants.map((g) => `${g.projectId}=${g.role}`).join(", ")}`,
            `  SecretOut:  ${secretTarget.displayPath} (mode 0600)`,
            "",
          ].join("\n");
          assertSafeOutputBuffer(text, emittedSecrets);
          out.write(text);
        } finally {
          db.close();
        }
      });
    });

const createAuthKeyListCommand = () =>
  new Command("list")
    .description(
      "List API credential public metadata without verifiers (query)",
    )
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .allowExcessArguments(false)
    .addHelpText(
      "after",
      `
Type: query (read-only)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Store access error
  2: Usage error
`,
    )
    .action(
      async (
        options: { format?: string; json?: boolean },
        command: Command,
      ) => {
        await withSignal("auth key list", async () => {
          const out = resolveCommandOutput(options, command);
          const authStore = createSqliteAuthStoreAdapter();
          try {
            const credentials = listApiCredentials({ authStore });
            if (out.isJson) {
              const payload = { credentials, total: credentials.length };
              assertSafeOutputBuffer(payload);
              out.write(payload);
              return;
            }

            if (credentials.length === 0) {
              out.write(
                "No API credentials found. Run 'gwrk auth key create --help' to issue one.\n",
              );
              return;
            }

            const idHeader = "Credential ID";
            const idWidth = credentials.reduce(
              (max, cred) => Math.max(max, cred.credentialId.length),
              idHeader.length,
            );
            const lines = [
              `${idHeader.padEnd(idWidth)}  Label                 Expires At                Status`,
              `${"─".repeat(idWidth)}  ────────────────────  ────────────────────────  ────────`,
            ];
            for (const cred of credentials) {
              const status = cred.revokedAt ? "revoked" : "active";
              lines.push(
                `${cred.credentialId.padEnd(idWidth)}  ${cred.label.slice(0, 20).padEnd(20)}  ${cred.expiresAt.slice(0, 24).padEnd(24)}  ${status}`,
              );
            }
            lines.push(`\n${credentials.length} API credential(s)\n`);
            const text = lines.join("\n");
            assertSafeOutputBuffer(text);
            out.write(text);
          } finally {
            authStore.close();
          }
        });
      },
    );

interface KeyRevokeOptions {
  reason?: string;
  format?: string;
  json?: boolean;
}

const createAuthKeyRevokeCommand = () =>
  new Command("revoke")
    .description("Revoke an API credential by public credential ID (mutator)")
    .argument("<credentialId>", "Public API credential ID (never a raw key)")
    .option("--reason <text>", "Revocation reason", "manual_revoke")
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .allowExcessArguments(false)
    .addHelpText(
      "after",
      `
Type: mutator (persists revocation and audit event)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Credential not found or store error
  2: Usage error
`,
    )
    .action(
      async (
        rawCredentialId: string,
        options: KeyRevokeOptions,
        command: Command,
      ) => {
        await withSignal("auth key revoke", async () => {
          const out = resolveCommandOutput(options, command);
          const credentialId = assertValidPublicIdFlag(rawCredentialId);

          const authStore = createSqliteAuthStoreAdapter();
          try {
            let result: ReturnType<typeof revokeApiCredential>;
            try {
              result = revokeApiCredential(
                { authStore, clock: systemClock() },
                {
                  credentialId,
                  reason: options.reason ?? "manual_revoke",
                },
              );
            } catch (err: unknown) {
              mapUseCaseError(err);
            }

            if (out.isJson) {
              const payload = {
                credentialId: result.credentialId,
                revoked: result.revoked,
                alreadyRevoked: result.alreadyRevoked,
              };
              assertSafeOutputBuffer(payload);
              out.write(payload);
              return;
            }

            const text = result.revoked
              ? `Revoked API credential: ${result.credentialId}\n`
              : `API credential already revoked: ${result.credentialId}\n`;
            assertSafeOutputBuffer(text);
            out.write(text);
          } finally {
            authStore.close();
          }
        });
      },
    );

interface KeyRotateOptions {
  expiresAt?: string;
  secretOut?: string;
  overlapUntil?: string;
  reason?: string;
  origin?: string;
  issuer?: string;
  format?: string;
  json?: boolean;
}

const createAuthKeyRotateCommand = () =>
  new Command("rotate")
    .description(
      "Atomically rotate an API credential, copying enrolled grants and revoking the old key by default (mutator)",
    )
    .argument(
      "<credentialId>",
      "Public API credential ID to rotate (never a raw key)",
    )
    .option("--expires-at <iso8601>", "Finite ISO-8601 expiry for rotated key")
    .option(
      "--secret-out <path>",
      "New owner-only (0600) output file outside any checkout",
    )
    .option(
      "--overlap-until <iso8601>",
      "Optional finite overlap deadline keeping the old key active until cutover",
    )
    .option("--reason <text>", "Rotation reason", "manual_rotation")
    .option(
      "--origin <url>",
      "Canonical HTTPS server origin audience (defaults to GWRK_AUTH_PUBLIC_ORIGIN)",
    )
    .option("--issuer <name>", "Issuer identifier", "local-admin")
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .allowExcessArguments(false)
    .addHelpText(
      "after",
      `
Type: mutator (atomically rotates credential and writes 0600 secret file)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success (stdout contains public metadata and secretOut path only)
  1: Credential not found, persistence, or secret delivery failure
  2: Usage, path, or policy validation error
`,
    )
    .action(
      async (
        rawCredentialId: string,
        options: KeyRotateOptions,
        command: Command,
      ) => {
        await withSignal("auth key rotate", async () => {
          const out = resolveCommandOutput(options, command);
          const targetCredentialId = assertValidPublicIdFlag(rawCredentialId);

          if (!options.expiresAt) {
            throw new CommandError(
              "Missing required --expires-at <iso8601>. Run 'gwrk auth key rotate --help' for usage.",
              2,
            );
          }
          if (!options.secretOut) {
            throw new CommandError(
              "Missing required --secret-out <path>. Run 'gwrk auth key rotate --help' for usage.",
              2,
            );
          }

          const audienceOrigin = resolveAudienceOrigin(options.origin);

          const db = openDatabase();
          try {
            const projectRegistry = createSqliteProjectRegistryAdapter({ db });
            const authStore = createSqliteAuthStoreAdapter({ db });
            const crypto = createCredentialCryptoAdapter();
            const secretTarget = validateSecretOutPath(
              options.secretOut,
              projectRegistry,
            );

            const emittedSecrets: string[] = [];
            const result = await rotateApiCredential(
              {
                authStore,
                grantAdmin: authStore,
                crypto,
                clock: systemClock(),
                deliverSecret: async (rawCredential) => {
                  emittedSecrets.push(rawCredential);
                  const secretPart = rawCredential.split(".")[2];
                  if (secretPart) emittedSecrets.push(secretPart);
                  writeSecretFileExclusive(
                    secretTarget.targetPath,
                    rawCredential,
                  );
                },
              },
              {
                targetCredentialId,
                issuer: options.issuer ?? "local-admin",
                audienceOrigin,
                expiresAt: options.expiresAt,
                ...(options.overlapUntil
                  ? { overlapUntil: options.overlapUntil }
                  : {}),
                reason: options.reason ?? "manual_rotation",
              },
            ).catch(mapUseCaseError);

            if (out.isJson) {
              const payload = {
                created: result.created,
                revokedCredentialId: result.revokedCredentialId,
                overlapUntil: result.overlapUntil,
                copiedGrants: result.copiedGrants,
                secretOut: secretTarget.displayPath,
              };
              assertSafeOutputBuffer(payload, emittedSecrets);
              out.write(payload);
              return;
            }

            const text = [
              `Rotated API credential: ${targetCredentialId} -> ${result.created.credentialId}`,
              `  Audience:      ${result.created.audienceOrigin}`,
              `  ExpiresAt:     ${result.created.expiresAt}`,
              `  RevokedOldId:  ${result.revokedCredentialId ?? "none"}`,
              `  OverlapUntil:  ${result.overlapUntil ?? "none"}`,
              `  CopiedGrants:  ${result.copiedGrants.map((g) => `${g.projectId}=${g.role}`).join(", ")}`,
              `  SecretOut:     ${secretTarget.displayPath} (mode 0600)`,
              "",
            ].join("\n");
            assertSafeOutputBuffer(text, emittedSecrets);
            out.write(text);
          } finally {
            db.close();
          }
        });
      },
    );

export const createAuthCommand = () =>
  new Command("auth")
    .description("Manage local hosted authentication credentials")
    .addCommand(
      new Command("key")
        .description("Create, list, revoke, and rotate local API credentials")
        .addCommand(createAuthKeyCreateCommand())
        .addCommand(createAuthKeyListCommand())
        .addCommand(createAuthKeyRevokeCommand())
        .addCommand(createAuthKeyRotateCommand()),
    );

export const authCommand = createAuthCommand();
