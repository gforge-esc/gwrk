import { z } from "zod";
export declare const HistoryEntrySchema: z.ZodObject<{
    timestamp: z.ZodString;
    featureId: z.ZodString;
    taskId: z.ZodString;
    fromStatus: z.ZodEnum<["open", "in_progress", "completed", "cancelled"]>;
    toStatus: z.ZodEnum<["open", "in_progress", "completed", "cancelled"]>;
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    featureId: string;
    timestamp: string;
    taskId: string;
    fromStatus: "open" | "in_progress" | "completed" | "cancelled";
    toStatus: "open" | "in_progress" | "completed" | "cancelled";
    agentId?: string | undefined;
}, {
    featureId: string;
    timestamp: string;
    taskId: string;
    fromStatus: "open" | "in_progress" | "completed" | "cancelled";
    toStatus: "open" | "in_progress" | "completed" | "cancelled";
    agentId?: string | undefined;
}>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export declare function appendHistory(entry: HistoryEntry): void;
