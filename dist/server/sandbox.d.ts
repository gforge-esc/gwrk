export interface SandboxOptions {
    featureId: string;
    phaseId: string;
    projectRoot: string;
    image?: string;
}
export declare class SandboxManager {
    private docker;
    constructor();
    checkDocker(): Promise<boolean>;
    createSandbox(opts: SandboxOptions): Promise<string>;
    destroySandbox(containerId: string): Promise<void>;
    listSandboxes(): Promise<{
        containerId: string;
        featureId: string;
        phaseId: string;
        status: string;
    }[]>;
}
