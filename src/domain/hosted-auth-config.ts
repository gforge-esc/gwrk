/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { evaluateOutboundCredentialTarget } from "./auth-policy.js";

const ENVIRONMENT_SETTINGS = {
  mode: "GWRK_AUTH_MODE",
  publicOrigin: "GWRK_AUTH_PUBLIC_ORIGIN",
  googleClientId: "GWRK_AUTH_GOOGLE_CLIENT_ID",
  googleAllowlistFile: "GWRK_AUTH_GOOGLE_ALLOWLIST_FILE",
  csrfHmacKeyFile: "GWRK_AUTH_CSRF_HMAC_FILE",
} as const;

type AuthField = keyof typeof ENVIRONMENT_SETTINGS;
const AUTH_FIELDS = Object.keys(ENVIRONMENT_SETTINGS) as AuthField[];
const KNOWN_ENVIRONMENT_KEYS = new Set<string>(
  Object.values(ENVIRONMENT_SETTINGS),
);

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function canonicalPosixFile(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.includes("\\") &&
    !hasControlCharacters(path) &&
    path
      .split("/")
      .slice(1)
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

// Sources remain partial until resolution so neither source silently overrides the other.
export const HostedAuthConfigInputSchema = z
  .object({
    mode: z.enum(["hosted", "trusted_local"]).optional(),
    publicOrigin: z
      .string()
      .refine(
        (boundOrigin) =>
          evaluateOutboundCredentialTarget({
            boundOrigin,
            targetUrl: boundOrigin,
          }).ok,
      )
      .optional(),
    googleClientId: z
      .string()
      .min(1)
      .refine((value) => !/\s/.test(value) && !hasControlCharacters(value))
      .optional(),
    googleAllowlistFile: z.string().refine(canonicalPosixFile).optional(),
    csrfHmacKeyFile: z.string().refine(canonicalPosixFile).optional(),
  })
  .strict();

export type HostedAuthConfigInput = z.infer<typeof HostedAuthConfigInputSchema>;
const CompleteHostedConfigSchema =
  HostedAuthConfigInputSchema.required().extend({ mode: z.literal("hosted") });
export type ResolvedHostedAuthConfig =
  | { readonly mode: "trusted_local" }
  | z.infer<typeof CompleteHostedConfigSchema>;
export type HostedAuthConfigResolution =
  | { readonly ok: true; readonly value: ResolvedHostedAuthConfig }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "AUTH_CONFIG_INVALID"
          | "AUTH_CONFIG_CONFLICT"
          | "AUTH_CONFIG_INCOMPLETE";
        readonly field: AuthField | "server.auth" | "environment";
        readonly message: string;
      };
    };

function deny(
  code:
    | "AUTH_CONFIG_INVALID"
    | "AUTH_CONFIG_CONFLICT"
    | "AUTH_CONFIG_INCOMPLETE",
  field: AuthField | "server.auth" | "environment",
): HostedAuthConfigResolution {
  return {
    ok: false,
    error: { code, field, message: "Authentication configuration denied" },
  };
}

function issueField(
  issues: readonly z.ZodIssue[],
  fallback: "server.auth" | "environment",
): AuthField | "server.auth" | "environment" {
  const first = issues[0]?.path[0];
  return typeof first === "string" && AUTH_FIELDS.includes(first as AuthField)
    ? (first as AuthField)
    : fallback;
}

export function resolveHostedAuthConfig(
  input: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly auth?: unknown;
  } = {},
): HostedAuthConfigResolution {
  const environment = input.environment ?? {};
  for (const [key, value] of Object.entries(environment)) {
    if (
      value !== undefined &&
      key.toUpperCase().startsWith("GWRK_AUTH_") &&
      !KNOWN_ENVIRONMENT_KEYS.has(key)
    )
      return deny("AUTH_CONFIG_INVALID", "environment");
  }
  const environmentAuth = Object.fromEntries(
    AUTH_FIELDS.flatMap((field) => {
      const value = environment[ENVIRONMENT_SETTINGS[field]];
      return value === undefined ? [] : [[field, value]];
    }),
  );
  const parsedEnvironment =
    HostedAuthConfigInputSchema.safeParse(environmentAuth);
  if (!parsedEnvironment.success)
    return deny(
      "AUTH_CONFIG_INVALID",
      issueField(parsedEnvironment.error.issues, "environment"),
    );
  const parsedAuth = HostedAuthConfigInputSchema.safeParse(
    input.auth === undefined ? {} : input.auth,
  );
  if (!parsedAuth.success)
    return deny(
      "AUTH_CONFIG_INVALID",
      issueField(parsedAuth.error.issues, "server.auth"),
    );

  const merged: Record<string, string> = {};
  for (const field of AUTH_FIELDS) {
    const fromEnvironment = parsedEnvironment.data[field];
    const fromAuth = parsedAuth.data[field];
    if (
      fromEnvironment !== undefined &&
      fromAuth !== undefined &&
      fromEnvironment !== fromAuth
    )
      return deny("AUTH_CONFIG_CONFLICT", field);
    const value = fromAuth ?? fromEnvironment;
    if (value !== undefined) merged[field] = value;
  }
  const hasHostedSettings = AUTH_FIELDS.some(
    (field) => field !== "mode" && merged[field] !== undefined,
  );
  if (merged.mode === "trusted_local")
    return hasHostedSettings
      ? deny("AUTH_CONFIG_INVALID", "mode")
      : { ok: true, value: { mode: "trusted_local" } };
  if (merged.mode === undefined && !hasHostedSettings)
    return { ok: true, value: { mode: "trusted_local" } };
  for (const field of AUTH_FIELDS)
    if (merged[field] === undefined)
      return deny("AUTH_CONFIG_INCOMPLETE", field);
  const complete = CompleteHostedConfigSchema.safeParse(merged);
  return complete.success
    ? { ok: true, value: complete.data }
    : deny("AUTH_CONFIG_INVALID", "server.auth");
}
