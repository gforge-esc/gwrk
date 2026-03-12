import type { FastifyInstance } from "fastify";
import type { DispatchQueue } from "../dispatch.js";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { SystemMonitor } from "../monitor.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
import type { SystemStatus } from "../types.js";
export declare function getStatusData(monitor: SystemMonitor, queue: DispatchQueue, sandbox: SandboxManager, lifecycle: LifecycleMonitor, network: NetworkMonitor, fastify?: FastifyInstance): Promise<SystemStatus>;
export declare function statusRoutes(fastify: FastifyInstance, monitor: SystemMonitor, queue: DispatchQueue, sandbox: SandboxManager, lifecycle: LifecycleMonitor, network: NetworkMonitor): Promise<void>;
