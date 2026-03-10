import type { FastifyInstance } from "fastify";
import type { SystemMonitor } from "../monitor.js";
import type { DispatchQueue } from "../dispatch.js";
import type { SandboxManager } from "../sandbox.js";
export declare function statusRoutes(fastify: FastifyInstance, monitor: SystemMonitor, queue: DispatchQueue, sandbox: SandboxManager): Promise<void>;
