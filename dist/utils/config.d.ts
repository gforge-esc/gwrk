import { z } from "zod";
declare const AgentBackendSchema: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
export type AgentBackend = z.infer<typeof AgentBackendSchema>;
export declare const GwrkConfigSchema: z.ZodObject<{
    project: z.ZodObject<{
        name: z.ZodString;
        githubRepo: z.ZodOptional<z.ZodString>;
        slackChannel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        githubRepo?: string | undefined;
        slackChannel?: string | undefined;
    }, {
        name: string;
        githubRepo?: string | undefined;
        slackChannel?: string | undefined;
    }>;
    agents: z.ZodObject<{
        define: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
        implement: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
    }, "strip", z.ZodTypeAny, {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    }, {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    }>;
    server: z.ZodObject<{
        port: z.ZodNumber;
        host: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
    }, {
        port: number;
        host: string;
    }>;
    parallelism: z.ZodObject<{
        local: z.ZodObject<{
            maxCpu: z.ZodNumber;
            maxMem: z.ZodNumber;
            minDiskGb: z.ZodNumber;
            maxClones: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        }, {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        }>;
        cloud: z.ZodObject<{
            maxConcurrent: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            maxConcurrent: number;
        }, {
            maxConcurrent: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        local: {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        };
        cloud: {
            maxConcurrent: number;
        };
    }, {
        local: {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        };
        cloud: {
            maxConcurrent: number;
        };
    }>;
    pulse: z.ZodOptional<z.ZodObject<{
        repos: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        repos: string[];
    }, {
        repos: string[];
    }>>;
}, "strip", z.ZodTypeAny, {
    project: {
        name: string;
        githubRepo?: string | undefined;
        slackChannel?: string | undefined;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    };
    server: {
        port: number;
        host: string;
    };
    parallelism: {
        local: {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        };
        cloud: {
            maxConcurrent: number;
        };
    };
    pulse?: {
        repos: string[];
    } | undefined;
}, {
    project: {
        name: string;
        githubRepo?: string | undefined;
        slackChannel?: string | undefined;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    };
    server: {
        port: number;
        host: string;
    };
    parallelism: {
        local: {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        };
        cloud: {
            maxConcurrent: number;
        };
    };
    pulse?: {
        repos: string[];
    } | undefined;
}>;
export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
export declare function loadConfig(projectRoot: string): GwrkConfig;
export {};
