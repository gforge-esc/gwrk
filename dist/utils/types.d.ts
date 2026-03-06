export interface VerdictResult {
    verdict: "GO" | "NO-GO";
    totalTasks: number;
    completedTasks: number;
    openTasks: OpenTask[];
}
export interface OpenTask {
    id: string;
    title: string;
    status: "open" | "in_progress";
}
