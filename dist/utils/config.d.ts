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
            masterChannelId: z.ZodOptional<z.ZodString>;
            masterChannelName: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            channelId: string;
            channelName: string;
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
        }, {
            channelId: string;
            channelName: string;
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        githubRepo?: string | undefined;
        slack?: {
            channelId: string;
            channelName: string;
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
        } | undefined;
    }, {
        name: string;
        githubRepo?: string | undefined;
        slack?: {
            channelId: string;
            channelName: string;
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
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
    server: z.ZodDefault<z.ZodObject<{
        port: z.ZodNumber;
        host: z.ZodString;
        heartbeatIntervalMs: z.ZodDefault<z.ZodNumber>;
        networkCheckIntervalMs: z.ZodDefault<z.ZodNumber>;
        slack: z.ZodOptional<z.ZodObject<{
            presencePollIntervalMs: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            presencePollIntervalMs: number;
        }, {
            presencePollIntervalMs?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        heartbeatIntervalMs: number;
        networkCheckIntervalMs: number;
        slack?: {
            presencePollIntervalMs: number;
        } | undefined;
    }, {
        port: number;
        host: string;
        slack?: {
            presencePollIntervalMs?: number | undefined;
        } | undefined;
        heartbeatIntervalMs?: number | undefined;
        networkCheckIntervalMs?: number | undefined;
    }>>;
    parallelism: z.ZodDefault<z.ZodObject<{
        local: z.ZodDefault<z.ZodObject<{
            maxCpu: z.ZodDefault<z.ZodNumber>;
            maxMem: z.ZodDefault<z.ZodNumber>;
            minDiskGb: z.ZodDefault<z.ZodNumber>;
            maxClones: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxCpu: number;
            maxMem: number;
            minDiskGb: number;
            maxClones: number;
        }, {
            maxCpu?: number | undefined;
            maxMem?: number | undefined;
            minDiskGb?: number | undefined;
            maxClones?: number | undefined;
        }>>;
        cloud: z.ZodDefault<z.ZodObject<{
            maxConcurrent: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            maxConcurrent: number;
        }, {
            maxConcurrent?: number | undefined;
        }>>;
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
        local?: {
            maxCpu?: number | undefined;
            maxMem?: number | undefined;
            minDiskGb?: number | undefined;
            maxClones?: number | undefined;
        } | undefined;
        cloud?: {
            maxConcurrent?: number | undefined;
        } | undefined;
    }>>;
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
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
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
        slack?: {
            presencePollIntervalMs: number;
        } | undefined;
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
            masterChannelId?: string | undefined;
            masterChannelName?: string | undefined;
        } | undefined;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
        fallbackOrder?: ("gemini" | "claude" | "codex" | "codex-cloud")[] | undefined;
    };
    server?: {
        port: number;
        host: string;
        slack?: {
            presencePollIntervalMs?: number | undefined;
        } | undefined;
        heartbeatIntervalMs?: number | undefined;
        networkCheckIntervalMs?: number | undefined;
    } | undefined;
    parallelism?: {
        local?: {
            maxCpu?: number | undefined;
            maxMem?: number | undefined;
            minDiskGb?: number | undefined;
            maxClones?: number | undefined;
        } | undefined;
        cloud?: {
            maxConcurrent?: number | undefined;
        } | undefined;
    } | undefined;
    pulse?: {
        repos: string[];
    } | undefined;
}>;
export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
export declare function loadConfig(projectRoot: string): GwrkConfig;
export {};
