import { Command } from "commander";
/**
 * gwrk define tasks <feature> — Decompose plan → tasks.json + gates
 *
 * Without flags:      refuses to overwrite existing tasks.json.
 * With --force:       blows away existing tasks.json + gates and regenerates fresh.
 * With --reconcile:   merges new plan into existing tasks, preserving completed status.
 */
export declare const tasksGenerateCommand: Command;
