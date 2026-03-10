import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { compileContext } from "./context.js";
import { startRun, finishRun } from "../db/runs.js";
import { persistDispatch } from "./persistence.js";
export class DispatchQueue {
    config;
    monitor;
    sandbox;
    git;
    projectRoot;
    queue = [];
    active = [];
    history = [];
    constructor(config, monitor, sandbox, git, projectRoot) {
        this.config = config;
        this.monitor = monitor;
        this.sandbox = sandbox;
        this.git = git;
        this.projectRoot = projectRoot;
    }
    enqueue(request) {
        const record = {
            id: crypto.randomUUID(),
            featureId: request.featureId,
            phaseId: request.phaseId,
            backend: request.backend || this.config.agents.implement,
            status: "queued",
            branchName: `phase/${request.featureId}-${request.phaseId}`,
            attempts: [],
            createdAt: new Date().toISOString(),
        };
        this.queue.push(record);
        persistDispatch(record);
        this.processNext();
        return record;
    }
    async processNext() {
        if (this.queue.length === 0)
            return;
        if (this.monitor.isThrottled()) {
            // Potentially log or wait
            return;
        }
        if (this.active.length >= this.config.parallelism.local.maxClones) {
            return;
        }
        const record = this.queue.shift();
        this.active.push(record);
        record.status = "running";
        persistDispatch(record);
        // Run in background
        this.runDispatch(record).catch(console.error);
    }
    async runDispatch(record) {
        const attempt = {
            attemptNumber: record.attempts.length + 1,
            backend: record.backend,
            startedAt: new Date().toISOString(),
        };
        attempt.runId = startRun({
            feature_id: record.featureId,
            phase_id: record.phaseId,
            command: `gwrk ship implement ${record.featureId} --phase ${record.phaseId}`,
            agent_backend: record.backend,
            workflow: "implement",
        });
        record.attempts.push(attempt);
        try {
            // 1. Prepare Git
            this.git.createPhaseBranch(record.featureId, record.phaseId);
            // 2. Prepare Context
            const context = compileContext(this.projectRoot, record.featureId, record.phaseId);
            const contextPath = path.join(this.projectRoot, ".gwrk", "phase-context.md");
            fs.mkdirSync(path.dirname(contextPath), { recursive: true });
            fs.writeFileSync(contextPath, context);
            // 3. Create Sandbox
            const containerId = await this.sandbox.createSandbox({
                featureId: record.featureId,
                phaseId: record.phaseId,
                backend: record.backend,
                projectRoot: this.projectRoot,
            });
            record.containerId = containerId;
            // 4. Simulate Agent Execution (for now)
            // TODO: Phase 06 — real agent execution
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await this.handleCompletion(record.id, 0, "");
        }
        catch (e) {
            await this.handleCompletion(record.id, 1, e.message || String(e));
        }
    }
    async handleCompletion(dispatchId, exitCode, stderr) {
        const record = this.active.find((r) => r.id === dispatchId);
        if (!record)
            return;
        const attempt = record.attempts[record.attempts.length - 1];
        attempt.completedAt = new Date().toISOString();
        attempt.exitCode = exitCode;
        attempt.stderr = stderr;
        if (attempt.runId) {
            const duration = Math.floor((new Date(attempt.completedAt).getTime() -
                new Date(attempt.startedAt).getTime()) /
                1000);
            finishRun(attempt.runId, {
                exit_code: exitCode,
                duration_s: duration,
            });
        }
        if (exitCode === 0) {
            record.status = "completed";
            record.completedAt = attempt.completedAt;
            // Merge back
            try {
                this.git.mergePhaseBack(record.featureId, record.phaseId);
            }
            catch (e) {
                console.error("Merge back failed:", e);
                // We still mark as completed, but merge failure is logged
            }
        }
        else {
            if (record.attempts.length < 3) {
                record.status = "retrying";
            }
            else {
                // Escalate to next backend in fallbackOrder
                const fallbackOrder = [
                    "gemini",
                    "claude",
                    "codex",
                    "codex-cloud",
                ];
                const currentIndex = fallbackOrder.indexOf(record.backend);
                if (currentIndex !== -1 && currentIndex < fallbackOrder.length - 1) {
                    record.backend = fallbackOrder[currentIndex + 1];
                    record.status = "retrying";
                }
                else {
                    record.status = "failed";
                }
            }
        }
        // Move from active to history/queue
        this.active = this.active.filter((r) => r.id !== record.id);
        if (record.status === "retrying") {
            this.queue.push(record);
        }
        else {
            this.history.push(record);
        }
        if (record.containerId) {
            try {
                await this.sandbox.destroySandbox(record.containerId);
            }
            catch (e) {
                console.error("Failed to destroy sandbox:", e);
            }
            record.containerId = undefined;
        }
        persistDispatch(record);
        this.processNext();
    }
    getQueue() {
        return {
            active: this.active,
            queued: this.queue,
            throttled: this.monitor.isThrottled(),
        };
    }
    getDispatch(featureId, phaseId) {
        return (this.active.find((r) => r.featureId === featureId && r.phaseId === phaseId) ||
            this.queue.find((r) => r.featureId === featureId && r.phaseId === phaseId) ||
            this.history.find((r) => r.featureId === featureId && r.phaseId === phaseId) ||
            null);
    }
    getQueueDepth() {
        return this.queue.length;
    }
    getActiveCount() {
        return this.active.length;
    }
    getCompletedCount() {
        return this.history.filter((r) => r.status === "completed").length;
    }
    getFailedCount() {
        return this.history.filter((r) => r.status === "failed").length;
    }
}
