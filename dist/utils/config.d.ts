import { z } from "zod";
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
        define: "gemini" | "codex-cloud" | "claude" | "codex";
        implement: "gemini" | "codex-cloud" | "claude" | "codex";
    }, {
        define: "gemini" | "codex-cloud" | "claude" | "codex";
        implement: "gemini" | "codex-cloud" | "claude" | "codex";
    }>;
}, "strip", z.ZodTypeAny, {
    project: {
        name: string;
    };
    agents: {
        define: "gemini" | "codex-cloud" | "claude" | "codex";
        implement: "gemini" | "codex-cloud" | "claude" | "codex";
    };
}, {
    project: {
        name: string;
    };
    agents: {
        define: "gemini" | "codex-cloud" | "claude" | "codex";
        implement: "gemini" | "codex-cloud" | "claude" | "codex";
    };
}>;
export type GwrkConfig = z.infer<typeof GwrkConfigSchema>;
export declare function loadConfig(projectRoot: string): GwrkConfig;
