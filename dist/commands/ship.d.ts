import { Command } from "commander";
/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Full autonomous lifecycle: branch → implement → review → PR → CI → done.
 * Delegates to scripts/dev/work-until-done.sh which orchestrates the complete
 * state machine with crash recovery and circuit breaking.
 */
export declare const shipCommand: Command;
