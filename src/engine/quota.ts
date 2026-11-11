/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  AgentBackend,
  QuotaStatus as AdapterQuotaStatus,
} from "../plugins/agent-backend.js";

type QuotaStatus = Omit<AdapterQuotaStatus, "status"> & {
  status: AdapterQuotaStatus["status"] | "unavailable";
};

/**
 * Probes the current quota status of a backend.
 * Uses the backend's native checkQuota if available, otherwise infers from recent errors or isAvailable().
 */
export async function quotaProbe(backend: AgentBackend): Promise<QuotaStatus> {
  // 1. Native checkQuota if implemented by the adapter
  if (typeof backend.checkQuota === "function") {
    try {
      return await backend.checkQuota();
    } catch (err) {
      // If native check fails, fall back to basic availability
    }
  }

  // 2. Fallback to basic isAvailable() check
  try {
    const available = await backend.isAvailable();
    if (!available) {
      return { status: "unavailable" };
    }
  } catch (err) {
    return { status: "unavailable" };
  }

  // 3. Default to available
  return { status: "available" };
}
