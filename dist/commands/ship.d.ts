import { Command } from "commander";
import { type AgentBackend } from "../utils/config.js";
import { type TaskResult } from "../utils/agent.js";
/**
 * FR-019: Direct agent dispatch via plugin facade (ADR-006).
 * Used when WUD orchestrator is not needed (e.g., single-task dispatch, testing).
 */
export declare function dispatchPhaseWork(feature: string, phase: string, backend: AgentBackend, workflow: string): Promise<TaskResult>;
/**
 * gwrk ship — The Shipping Pillar (Throughput)
 *
 * Full autonomous lifecycle: branch → implement → review → PR → CI → done.
 * Phase is optional — when omitted, ships all phases of the feature sequentially.
 */
export declare const shipCommand: Command;
