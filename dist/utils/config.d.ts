import { z } from "zod";
declare const AgentBackendSchema: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
export type AgentBackend = z.infer<typeof AgentBackendSchema>;
export declare const SlackConfigSchema: z.ZodObject<{
    botToken: z.ZodString;
    appToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    botToken: string;
    appToken: string;
}, {
    botToken: string;
    appToken: string;
}>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export declare const GwrkConfigSchema: z.ZodObject<{
    project: z.ZodObject<{
        name: z.ZodString;
        githubRepo: z.ZodOptional<z.ZodString>;
        slack: z.ZodOptional<z.ZodObject<{
            channelId: z.ZodString;
            channelName: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            channelId: string;
            channelName: string;
        }, {
            channelId: string;
            channelName: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        githubRepo?: string | undefined;
        slack?: {
            channelId: string;
            channelName: string;
        } | undefined;
    }, {
        name: string;
        githubRepo?: string | undefined;
        slack?: {
            channelId: string;
            channelName: string;
        } | undefined;
    }>;
    agents: z.ZodObject<{
        define: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
        implement: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
        fallbackOrder: z.ZodOptional<z.ZodArray<z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
        fallbackOrder?: ("gemini" | "claude" | "codex" | "codex-cloud")[] | undefined;
    }, {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
        fallbackOrder?: ("gemini" | "claude" | "codex" | "codex-cloud")[] | undefined;
    }>;
    server: z.ZodObject<{
        port: z.ZodNumber;
        host: z.ZodString;
        heartbeatIntervalMs: z.ZodNumber;
        networkCheckIntervalMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        heartbeatIntervalMs: number;
        networkCheckIntervalMs: number;
    }, {
        port: number;
        host: string;
        heartbeatIntervalMs: number;
        networkCheckIntervalMs: number;
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
        slack?: {
            channelId: string;
            channelName: string;
        } | undefined;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
        fallbackOrder?: ("gemini" | "claude" | "codex" | "codex-cloud")[] | undefined;
    };
    server: {
        port: number;
        host: string;
        heartbeatIntervalMs: number;
        networkCheckIntervalMs: number;
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
        slack?: {
            channelId: string;
            channelName: string;
        } | undefined;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
        fallbackOrder?: ("gemini" | "claude" | "codex" | "codex-cloud")[] | undefined;
    };
    server: {
        port: number;
        host: string;
        heartbeatIntervalMs: number;
        networkCheckIntervalMs: number;
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
