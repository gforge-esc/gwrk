import type { Phase } from "./state.js";
/**
 * generateGates — write gate shell scripts for each task.
 *
 * Gate authoring strategy (priority order):
 *
 * 1. AUTHORED — if a pre-written gate exists at gates/TASK_ID-gate.sh already,
 *    leave it untouched. Authored gates (by an LLM or human) always win.
 *
 * 2. DONE WHEN — extract backtick-wrapped shell commands from the phase's
 *    "Done When" section and use the ones relevant to this task's file.
 *
 * 3. TYPED FALLBACK — by file extension:
 *    - .test.ts → pnpm vitest run <file>
 *    - .sql     → test -f + grep for expected column names
 *    - .ts/.js  → identifier grep + compiled output check
 *    - .sh      → bash -n (syntax check)
 *    - other    → test -s (non-empty)
 *
 * 4. ABSOLUTE FALLBACK — pnpm build exits 0.
 *
 * NOTE: File-existence-only (test -f) gates are NEVER emitted as the sole
 * assertion. Every gate must make a functional claim.
 */
export declare function generateGates(featureDir: string, phases: Phase[]): void;
