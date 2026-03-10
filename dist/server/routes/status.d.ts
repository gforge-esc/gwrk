import type { FastifyInstance } from "fastify";
import type { DispatchQueue } from "../dispatch.js";
import type { SystemMonitor } from "../monitor.js";
export declare function statusRoutes(fastify: FastifyInstance, monitor: SystemMonitor, queue: DispatchQueue): Promise<void>;
