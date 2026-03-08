import { Command } from "commander";
export declare const implementAction: (feature: string, phase: string, opts: {
    dryRun?: boolean;
    agent?: string;
}) => Promise<void>;
export declare const implementCommand: Command;
