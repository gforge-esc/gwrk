/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Compression engine stubs — FR-007 scope (not yet implemented).
 * computeCompression and gatherDeliveryActuals are called by harvest.ts
 * and commands/compression.ts. They fail silently in try/catch wrappers.
 */
export function computeCompression(_forecast: any, _actuals?: any): any {
  throw new Error('Not implemented: computeCompression (FR-007)');
}
export function gatherDeliveryActuals(_featDir: string, _days?: number, _prNumber?: number): any {
  throw new Error('Not implemented: gatherDeliveryActuals (FR-007)');
}
export function computeForecastFromLOC(_featDir: string): any {
  throw new Error('Not implemented: computeForecastFromLOC (FR-007)');
}
export function generateSummary(_reports?: any): any {
  throw new Error('Not implemented: generateSummary (FR-007)');
}
