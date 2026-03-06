import fs from "node:fs";
export function parsePlan(planPath) {
    if (!fs.existsSync(planPath)) {
        throw new Error(`Plan file not found at ${planPath}`);
    }
    const content = fs.readFileSync(planPath, "utf-8");
    const phases = [];
    // Split by phase headers: "### Phase N: Title"
    const phaseSections = content.split(/^### Phase /m).slice(1);
    for (let index = 0; index < phaseSections.length; index++) {
        const section = phaseSections[index];
        const lines = section.split("\n");
        const titleLine = lines[0];
        const colonIndex = titleLine.indexOf(":");
        let title = "";
        if (colonIndex !== -1) {
            title = titleLine.slice(colonIndex + 1).trim();
        }
        else {
            title = titleLine.trim();
        }
        const phaseId = `phase-${(index + 1).toString().padStart(2, "0")}`;
        const tasks = [];
        // Extract files as tasks: "**Files (N):**" followed by bullet points
        const filesMatch = section.match(/\*\*Files \(\d+\):\*\*\n((?:- .*\n?)+)/);
        if (filesMatch) {
            const fileLines = filesMatch[1].trim().split("\n");
            for (const line of fileLines) {
                // Format: - `file.ts` (Description)
                const match = line.match(/- `(.*?)` \((.*?)\)/);
                if (match) {
                    tasks.push({
                        title: `Implement ${match[1]}`,
                        description: match[2],
                    });
                }
                else {
                    const matchSimple = line.match(/- `(.*?)`/);
                    if (matchSimple) {
                        tasks.push({
                            title: `Implement ${matchSimple[1]}`,
                            description: `Implement changes for ${matchSimple[1]}`,
                        });
                    }
                }
            }
        }
        // Extract tests as a task: "#### Test Strategy"
        const testStrategyMatch = section.match(/#### Test Strategy\n([\s\S]*?)(?:\n####|$)/);
        if (testStrategyMatch) {
            tasks.push({
                title: `Implement test strategy for Phase ${index + 1}`,
                description: "Implement all unit and integration tests defined in the phase test strategy.",
            });
        }
        // Extract Done When assertions
        const doneWhen = [];
        const doneWhenMatch = section.match(/#### Done When\n((?:- .*\n?)+)/);
        if (doneWhenMatch) {
            const lines = doneWhenMatch[1].trim().split("\n");
            for (const line of lines) {
                const m = line.match(/- (.*)/);
                if (m)
                    doneWhen.push(m[1].trim());
            }
        }
        phases.push({
            id: phaseId,
            title,
            tasks,
            doneWhen,
        });
    }
    return { phases };
}
