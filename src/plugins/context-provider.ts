/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Result returned by a context provider
 */
export interface ContextResult {
  source: string;
  content: string;
  relevance: number; // 0-1
}

/**
 * Interface for plugins that provide external context
 */
export interface ContextProvider {
  /**
   * Resolve context based on keywords and project state
   */
  resolveContext(params: {
    keywords: string[];
    projectRoot: string;
    config: Record<string, any>;
  }): Promise<ContextResult[]>;
}
