export interface ParsedTask {
    title: string;
    description: string;
}
export interface ParsedPhase {
    id: string;
    title: string;
    tasks: ParsedTask[];
    doneWhen: string[];
    sp?: number;
}
export declare function parsePlan(planPath: string): {
    phases: ParsedPhase[];
};
