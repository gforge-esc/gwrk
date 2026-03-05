import { z } from "zod";
declare const AgentBackendSchema: z.ZodEnum<["gemini", "claude", "codex", "codex-cloud"]>;
export type AgentBackend = z.infer<typeof AgentBackendSchema>;
export declare const GwrkConfigSchema: z.ZodObject<{
    project: z.ZodObject<{
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
    }, {
        name: string;
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
}, "strip", z.ZodTypeAny, {
    project: {
        name: string;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    };
}, {
    project: {
        name: string;
    };
    agents: {
        define: "gemini" | "claude" | "codex" | "codex-cloud";
        implement: "gemini" | "claude" | "codex" | "codex-cloud";
    };
}>;
export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
export declare function loadConfig(projectRoot: string): GwrkConfig;
export {};
