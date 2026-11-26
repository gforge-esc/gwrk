/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DiscoveredModel } from "../../domain/model-qualification.js";

const families = [
  { prefix: "gemini-", provider: "google", family: "gemini" },
  { prefix: "claude-", provider: "anthropic", family: "claude" },
  { prefix: "gpt-oss-", provider: "openai", family: "gpt" },
];

export function parseAgyModelList(stdout: string): DiscoveredModel[] {
  const models = new Map<string, DiscoveredModel>();
  for (const line of stdout.split("\n")) {
    const [modelId, label] = line.trim().split("\t");
    if (!label || !/^[a-z0-9][a-z0-9.-]+$/i.test(modelId)) continue;
    const identity = families.find(({ prefix }) => modelId.startsWith(prefix));
    if (!identity) continue;
    const effort = modelId.match(/-(low|medium|high|xhigh|max)$/)?.[1];
    models.set(modelId, {
      backend: "agy",
      modelId,
      provider: identity.provider,
      family: identity.family,
      supportedEfforts: effort ? [effort] : [],
      isDefault: false,
      hidden: false,
    });
  }
  return [...models.values()];
}
