import { Command } from "commander";
/**
 * gwrk define — The DUS Pillar (Clarity)
 *
 * User-facing commands:
 *   gwrk define <feature> [--refs <path>]     Full DUS loop
 *   gwrk define spec <feature>                Create/refine spec
 *   gwrk define plan <feature>                Create implementation plan
 *   gwrk define tasks <feature>               Decompose plan → tasks + gates
 *
 * Internal DUS stages (NOT exposed as subcommands):
 *   analyze, checklist, tests — run inside the DUS loop automatically
 */
export declare const defineCommand: Command;
