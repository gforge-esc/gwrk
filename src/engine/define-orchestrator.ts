import fs from "node:fs";
import path from "node:path";
import {
  type WorkflowOptions,
  type WorkflowResult,
  WorkflowRuntime,
} from "../plugins/workflow-runtime.js";

export type DefineStage = "SPEC" | "PLAN" | "TASKS" | "COMPLETE";

export interface DefineOptions extends WorkflowOptions {
  interactive?: boolean;
  refs?: string;
}

/**
 * The DefineOrchestrator manages the specification -> plan -> tasks loop.
 * It uses the WorkflowRuntime to execute each stage as a plugin-based workflow.
 */
export class DefineOrchestrator {
  private runtime: WorkflowRuntime;

  constructor(runtime?: WorkflowRuntime) {
    this.runtime = runtime || new WorkflowRuntime();
  }

  /**
   * Executes the specification stage.
   * Creates or refines a feature specification.
   */
  async executeSpecify(
    feature: string,
    prompt?: string,
    options: DefineOptions = {},
  ): Promise<WorkflowResult> {
    const projectRoot = options.projectRoot || process.cwd();
    const specFile = path.join(projectRoot, "specs", feature, "spec.md");
    const isRework = fs.existsSync(specFile);

    let input: string;
    if (isRework) {
      const reworkInstructions =
        prompt || "Review and refine this specification";
      input = `REWORK existing spec for feature ${feature}.\n\nExisting spec: specs/${feature}/spec.md\n\nRework instructions: ${reworkInstructions}`;
    } else {
      if (!prompt) {
        throw new Error(
          `No spec found at specs/${feature}/spec.md and no prompt provided.`,
        );
      }
      input = `Create a NEW spec for feature ${feature}.\n\nDescription: ${prompt}`;
    }

    if (options.refs && fs.existsSync(options.refs)) {
      const refsContent = fs.readFileSync(options.refs, "utf-8");
      input += `\n\nReference document (${options.refs}):\n${refsContent}`;
    }

    return this.runtime.executeWorkflow("gwrk-specify", input, options);
  }

  /**
   * Executes the planning stage.
   * Creates an implementation plan and contracts.
   */
  async executePlan(
    feature: string,
    options: DefineOptions = {},
  ): Promise<WorkflowResult> {
    const projectRoot = options.projectRoot || process.cwd();
    const specPath = path.join(projectRoot, "specs", feature, "spec.md");

    if (!fs.existsSync(specPath)) {
      throw new Error(
        `spec.md not found at ${specPath}. Run 'gwrk define spec ${feature}' first.`,
      );
    }

    const specContent = fs.readFileSync(specPath, "utf-8");
    if (/^>?\s*\*\*Status:\*\*\s*Stub/im.test(specContent)) {
      throw new Error(
        `Spec ${feature} is marked as a Stub. Run 'gwrk define spec ${feature}' first.`,
      );
    }

    let input = `Create an implementation plan for feature ${feature} based on specs/${feature}/spec.md`;

    if (options.refs && fs.existsSync(options.refs)) {
      const refsContent = fs.readFileSync(options.refs, "utf-8");
      input += `\n\nReference document (${options.refs}):\n${refsContent}`;
    }

    return this.runtime.executeWorkflow("gwrk-plan", input, options);
  }

  /**
   * Executes the task generation stage.
   * Authors gate scripts for the tasks defined in the plan.
   */
  async executeTasks(
    feature: string,
    context?: string, // Usually the brief path or phase
    options: DefineOptions = {},
  ): Promise<WorkflowResult> {
    const input = context || feature;
    return this.runtime.executeWorkflow("gwrk-author-gates", input, options);
  }

  /**
   * Executes the test generation stage.
   * Generates RED test files from spec/plan/contracts.
   */
  async executeDefineTests(
    feature: string,
    phase?: string,
    options: DefineOptions = {},
  ): Promise<WorkflowResult> {
    return this.runtime.executeWorkflow(
      "gwrk-define-tests",
      phase || feature,
      options,
    );
  }

  /**
   * Runs the full definition loop: SPEC -> PLAN -> TASKS -> ANALYZE -> DEFINE_TESTS.
   */
  async runLoop(
    feature: string,
    prompt?: string,
    options: DefineOptions = {},
  ): Promise<DefineStage> {
    const projectRoot = options.projectRoot || process.cwd();
    const specFile = path.join(projectRoot, "specs", feature, "spec.md");
    const planFile = path.join(projectRoot, "specs", feature, "plan.md");
    const tasksFile = path.join(
      projectRoot,
      "specs",
      feature,
      ".gwrk",
      "tasks.json",
    );
    const gapMatrixFile = path.join(
      projectRoot,
      "specs",
      feature,
      "gap-matrix.md",
    );

    let currentStage: DefineStage = "SPEC";

    // Determine starting stage based on existing files
    if (fs.existsSync(gapMatrixFile)) {
      currentStage = "COMPLETE";
    } else if (fs.existsSync(tasksFile)) {
      currentStage = "TASKS"; // Should we go back to tasks to author gates?
    } else if (fs.existsSync(planFile)) {
      currentStage = "TASKS";
    } else if (fs.existsSync(specFile)) {
      currentStage = "PLAN";
    }

    while (currentStage !== "COMPLETE") {
      switch (currentStage) {
        case "SPEC":
          await this.executeSpecify(feature, prompt, options);
          currentStage = "PLAN";
          break;

        case "PLAN":
          await this.executePlan(feature, options);
          currentStage = "TASKS";
          break;

        case "TASKS":
          // In the full loop, we execute define-tests which also produces gap-matrix.
          // But define-until-solid.sh also runs plan-to-tasks.
          // For now, let's just run the workflows we have.
          await this.executeTasks(feature, undefined, options);
          currentStage = "COMPLETE"; // Or next stage if we add more
          break;
      }

      if (options.interactive && currentStage !== "COMPLETE") {
        // ...
      }
    }

    return currentStage;
  }
}
