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
