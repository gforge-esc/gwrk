import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { finishRun, startRun } from "../db/runs.js";
import { compileContext } from "./context.js";
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
        record.attempts.push(attempt);
        const runId = startRun({
            feature_id: record.featureId,
            phase_id: record.phaseId,
            command: "ship",
            agent_backend: record.backend,
            workflow: "implement",
        });
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
            // 4. Simulate Agent Execution (using actual ship command placeholder)
            // In real life we would run something like:
            // docker exec <id> node /workspace/dist/cli.js ship implement <featureId> --phase <phaseId>
            await new Promise((resolve) => setTimeout(resolve, 100));
            record.status = "completed";
            attempt.completedAt = new Date().toISOString();
            attempt.exitCode = 0;
            finishRun(runId, {
                exit_code: 0,
                duration_s: Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000),
            });
        }
        catch (e) {
            attempt.completedAt = new Date().toISOString();
            attempt.exitCode = 1;
            attempt.error = e.message;
            if (record.attempts.length < 3) {
                record.status = "retrying";
            }
            else {
                // Fallback logic
                const fallbackOrder = this.config.agents.fallbackOrder || [];
                const currentIndex = fallbackOrder.indexOf(record.backend);
                if (currentIndex !== -1 && currentIndex < fallbackOrder.length - 1) {
                    record.backend = fallbackOrder[currentIndex + 1];
                    record.status = "retrying";
                    record.attempts = [];
                }
                else {
                    record.status = "failed";
                }
            }
            finishRun(runId, {
                exit_code: 1,
                duration_s: Math.round((Date.now() - new Date(attempt.startedAt).getTime()) / 1000),
                retry_reason: record.status === "retrying" ? e.message : undefined,
            });
        }
        finally {
            if (record.containerId) {
                await this.sandbox.destroySandbox(record.containerId);
                record.containerId = undefined;
            }
            this.active = this.active.filter((r) => r.id !== record.id);
            if (record.status === "retrying") {
                // Re-queue it at the front for FIFO if desired, but here it says FIFO ordering.
                // Usually retries go to the back or the front. Let's put it at the back for simplicity
                // or re-think. Spec says FIFO ordering of the queue.
                this.queue.push(record);
            }
            else {
                record.completedAt = new Date().toISOString();
                this.history.push(record);
            }
            persistDispatch(record);
            this.processNext();
        }
    }
    getStatus() {
        return {
            active: this.active,
            queued: this.queue,
            history: this.history,
        };
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
