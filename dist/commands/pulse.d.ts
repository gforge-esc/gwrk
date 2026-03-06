import type { Command } from "commander";
import type { PulseReport, PulseSnapshot } from "../engine/types.js";
export declare function renderPulseTable(report: PulseReport): string;
export declare function renderSnapshotTable(snap: PulseSnapshot): string;
export declare function registerPulseCommands(program: Command): void;
export declare function registerPulseSubcommands(program: Command): void;
