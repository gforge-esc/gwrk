import * as fs from "node:fs";
import * as path from "node:path";
export function compileContext(projectRoot, featureId, phaseId) {
    let context = "# gwrk Phase Context\n\n";
    // 1. Governance Rules
    context += "## Governance Rules\n\n";
    const rulesDir = path.join(projectRoot, ".agent/rules");
    if (fs.existsSync(rulesDir)) {
        const rules = fs.readdirSync(rulesDir).filter(f => f.endsWith(".md")).sort();
        for (const rule of rules) {
            context += `### ${rule}\n\n`;
            context += fs.readFileSync(path.join(rulesDir, rule), "utf-8");
            context += "\n\n";
        }
    }
    // 2. Persona
    context += "## Persona\n\n";
    const personasDir = path.join(projectRoot, ".agent/prompts/personas");
    if (fs.existsSync(personasDir)) {
        const personas = fs.readdirSync(personasDir).filter(f => f.endsWith(".md")).sort();
        for (const persona of personas) {
            context += `### ${persona}\n\n`;
            context += fs.readFileSync(path.join(personasDir, persona), "utf-8");
            context += "\n\n";
        }
    }
    // 3. Spec & Plan
    const specPath = path.join(projectRoot, `specs/${featureId}/spec.md`);
    const planPath = path.join(projectRoot, `specs/${featureId}/plan.md`);
    if (fs.existsSync(specPath)) {
        context += "## Feature Specification\n\n";
        context += fs.readFileSync(specPath, "utf-8");
        context += "\n\n";
    }
    if (fs.existsSync(planPath)) {
        context += "## Implementation Plan\n\n";
        context += fs.readFileSync(planPath, "utf-8");
        context += "\n\n";
    }
    // 4. Tasks
    const tasksPath = path.join(projectRoot, `specs/${featureId}/.gwrk/tasks.json`);
    if (fs.existsSync(tasksPath)) {
        context += "## Tasks\n\n";
        try {
            const raw = fs.readFileSync(tasksPath, "utf-8");
            context += "```json\n";
            context += raw;
            context += "\n```\n\n";
        }
        catch (e) {
            context += "Error reading tasks.json\n\n";
        }
    }
    return context;
}
