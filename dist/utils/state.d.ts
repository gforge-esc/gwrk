import { z } from "zod";
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<["open", "in_progress", "completed", "cancelled"]>;
    gateScript: z.ZodString;
    completedAt: z.ZodOptional<z.ZodString>;
    classification: z.ZodOptional<z.ZodEnum<["greenfield", "change", "refactor", "noop"]>>;
}, "strip", z.ZodTypeAny, {
    status: "open" | "in_progress" | "completed" | "cancelled";
    id: string;
    description: string;
    title: string;
    gateScript: string;
    completedAt?: string | undefined;
    classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
}, {
    status: "open" | "in_progress" | "completed" | "cancelled";
    id: string;
    description: string;
    title: string;
    gateScript: string;
    completedAt?: string | undefined;
    classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
}>;
export declare const PhaseSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<["open", "in_progress", "completed", "cancelled"]>;
        gateScript: z.ZodString;
        completedAt: z.ZodOptional<z.ZodString>;
        classification: z.ZodOptional<z.ZodEnum<["greenfield", "change", "refactor", "noop"]>>;
    }, "strip", z.ZodTypeAny, {
        status: "open" | "in_progress" | "completed" | "cancelled";
        id: string;
        description: string;
        title: string;
        gateScript: string;
        completedAt?: string | undefined;
        classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
    }, {
        status: "open" | "in_progress" | "completed" | "cancelled";
        id: string;
        description: string;
        title: string;
        gateScript: string;
        completedAt?: string | undefined;
        classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
    }>, "many">;
    doneWhen: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    objective: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodObject<{
        in_scope: z.ZodArray<z.ZodString, "many">;
        out_of_scope: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        in_scope: string[];
        out_of_scope: string[];
    }, {
        in_scope: string[];
        out_of_scope: string[];
    }>>;
    classification_summary: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    inputs: z.ZodOptional<z.ZodObject<{
        spec_refs: z.ZodArray<z.ZodString, "many">;
        project_signals: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        spec_refs: string[];
        project_signals: string[];
    }, {
        spec_refs: string[];
        project_signals: string[];
    }>>;
}, "strip", z.ZodTypeAny, {
    id: string;
    title: string;
    tasks: {
        status: "open" | "in_progress" | "completed" | "cancelled";
        id: string;
        description: string;
        title: string;
        gateScript: string;
        completedAt?: string | undefined;
        classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
    }[];
    doneWhen?: string[] | undefined;
    objective?: string | undefined;
    scope?: {
        in_scope: string[];
        out_of_scope: string[];
    } | undefined;
    classification_summary?: Record<string, number> | undefined;
    inputs?: {
        spec_refs: string[];
        project_signals: string[];
    } | undefined;
}, {
    id: string;
    title: string;
    tasks: {
        status: "open" | "in_progress" | "completed" | "cancelled";
        id: string;
        description: string;
        title: string;
        gateScript: string;
        completedAt?: string | undefined;
        classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
    }[];
    doneWhen?: string[] | undefined;
    objective?: string | undefined;
    scope?: {
        in_scope: string[];
        out_of_scope: string[];
    } | undefined;
    classification_summary?: Record<string, number> | undefined;
    inputs?: {
        spec_refs: string[];
        project_signals: string[];
    } | undefined;
}>;
export declare const TaskStateSchema: z.ZodObject<{
    featureId: z.ZodString;
    createdAt: z.ZodString;
    generatedFrom: z.ZodOptional<z.ZodObject<{
        plan: z.ZodObject<{
            hash: z.ZodString;
            modifiedAt: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            hash: string;
            modifiedAt: string;
        }, {
            hash: string;
            modifiedAt: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        plan: {
            hash: string;
            modifiedAt: string;
        };
    }, {
        plan: {
            hash: string;
            modifiedAt: string;
        };
    }>>;
    phases: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        tasks: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            title: z.ZodString;
            description: z.ZodString;
            status: z.ZodEnum<["open", "in_progress", "completed", "cancelled"]>;
            gateScript: z.ZodString;
            completedAt: z.ZodOptional<z.ZodString>;
            classification: z.ZodOptional<z.ZodEnum<["greenfield", "change", "refactor", "noop"]>>;
        }, "strip", z.ZodTypeAny, {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }, {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }>, "many">;
        doneWhen: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        objective: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodObject<{
            in_scope: z.ZodArray<z.ZodString, "many">;
            out_of_scope: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            in_scope: string[];
            out_of_scope: string[];
        }, {
            in_scope: string[];
            out_of_scope: string[];
        }>>;
        classification_summary: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        inputs: z.ZodOptional<z.ZodObject<{
            spec_refs: z.ZodArray<z.ZodString, "many">;
            project_signals: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            spec_refs: string[];
            project_signals: string[];
        }, {
            spec_refs: string[];
            project_signals: string[];
        }>>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        title: string;
        tasks: {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }[];
        doneWhen?: string[] | undefined;
        objective?: string | undefined;
        scope?: {
            in_scope: string[];
            out_of_scope: string[];
        } | undefined;
        classification_summary?: Record<string, number> | undefined;
        inputs?: {
            spec_refs: string[];
            project_signals: string[];
        } | undefined;
    }, {
        id: string;
        title: string;
        tasks: {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }[];
        doneWhen?: string[] | undefined;
        objective?: string | undefined;
        scope?: {
            in_scope: string[];
            out_of_scope: string[];
        } | undefined;
        classification_summary?: Record<string, number> | undefined;
        inputs?: {
            spec_refs: string[];
            project_signals: string[];
        } | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    featureId: string;
    createdAt: string;
    phases: {
        id: string;
        title: string;
        tasks: {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }[];
        doneWhen?: string[] | undefined;
        objective?: string | undefined;
        scope?: {
            in_scope: string[];
            out_of_scope: string[];
        } | undefined;
        classification_summary?: Record<string, number> | undefined;
        inputs?: {
            spec_refs: string[];
            project_signals: string[];
        } | undefined;
    }[];
    generatedFrom?: {
        plan: {
            hash: string;
            modifiedAt: string;
        };
    } | undefined;
}, {
    featureId: string;
    createdAt: string;
    phases: {
        id: string;
        title: string;
        tasks: {
            status: "open" | "in_progress" | "completed" | "cancelled";
            id: string;
            description: string;
            title: string;
            gateScript: string;
            completedAt?: string | undefined;
            classification?: "greenfield" | "change" | "refactor" | "noop" | undefined;
        }[];
        doneWhen?: string[] | undefined;
        objective?: string | undefined;
        scope?: {
            in_scope: string[];
            out_of_scope: string[];
        } | undefined;
        classification_summary?: Record<string, number> | undefined;
        inputs?: {
            spec_refs: string[];
            project_signals: string[];
        } | undefined;
    }[];
    generatedFrom?: {
        plan: {
            hash: string;
            modifiedAt: string;
        };
    } | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export declare function loadTaskState(featureDir: string): TaskState;
export declare function saveTaskState(featureDir: string, state: TaskState): void;
export declare function markTaskComplete(state: TaskState, taskId: string): TaskState;
export declare function listTasks(state: TaskState): Task[];
export declare function nextTask(state: TaskState, phaseId: string): Task | null;
/** SHA256 of file contents — used for provenance tracking */
export declare function contentHash(filePath: string): string;
