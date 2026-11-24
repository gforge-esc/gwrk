/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const INBOUND_AUTH_KEYS = new Set([
  "GWRK_API_KEY",
  "GWRK_SERVER_API_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "AUTHORIZATION",
  "HTTP_AUTHORIZATION",
  "COOKIE",
  "HTTP_COOKIE",
  "SET_COOKIE",
]);

// Call after inherited and explicit environments have been merged.
export function filterWorkerAuthEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const normalized = key.toUpperCase();
      return (
        !normalized.startsWith("GWRK_AUTH_") &&
        !normalized.startsWith("OAUTH2_PROXY_") &&
        !INBOUND_AUTH_KEYS.has(normalized)
      );
    }),
  );
}
