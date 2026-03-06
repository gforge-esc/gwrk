import type { FastifyInstance } from "fastify";
import { SystemMonitor } from "../monitor.js";
import { DispatchQueue } from "../dispatch.js";
export declare function statusRoutes(fastify: FastifyInstance, monitor: SystemMonitor, queue: DispatchQueue): Promise<void>;
