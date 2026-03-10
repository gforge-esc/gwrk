import type { FastifyInstance } from "fastify";
import type { LifecycleMonitor } from "../lifecycle.js";
import type { NetworkMonitor } from "../network.js";
import type { SandboxManager } from "../sandbox.js";
export declare function healthRoutes(server: FastifyInstance, lifecycle: LifecycleMonitor, network: NetworkMonitor, sandbox: SandboxManager): Promise<void>;
