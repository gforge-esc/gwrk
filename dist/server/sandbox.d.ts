import type { AgentBackend } from "../utils/config.js";
import type { SandboxInfo } from "./types.js";
export interface SandboxOptions {
    featureId: string;
    phaseId: string;
    taskId: string;
    backend: AgentBackend;
    projectRoot: string;
}
export declare class SandboxManager {
    private runsDir;
    constructor(projectRoot?: string);
    checkGit(): Promise<boolean>;
    createSandbox(opts: SandboxOptions): Promise<string>;
    destroySandbox(workDir: string, featureId: string): Promise<void>;
    listSandboxes(): Promise<SandboxInfo[]>;
    pruneSandboxes(): Promise<void>;
}
