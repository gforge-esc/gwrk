import { Command } from "commander";
/**
 * gwrk define — The Definition Pillar (Clarity)
 *
 * User-facing commands:
 *   gwrk define <feature> [--refs <path>]     Full definition loop
 *   gwrk define spec <feature>                Create/refine spec
 *   gwrk define plan <feature>                Create implementation plan
 *   gwrk define tasks <feature>               Decompose plan → tasks + gates
 *   gwrk define tests <feature> <phase>       Generate RED tests for a phase
 *
 * Internal definition stages (NOT exposed as subcommands):
 *   analyze, checklist — run inside the definition loop automatically
 */
export declare const defineCommand: Command;
