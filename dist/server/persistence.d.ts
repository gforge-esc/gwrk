import type { DispatchRecord } from "./types.js";
/**
 * Appends a dispatch record to the persistent .gwrk/dispatches.jsonl log in the project root.
 * Creates the directory and file if they do not exist.
 */
export declare function persistDispatch(record: DispatchRecord, projectRoot?: string): void;
