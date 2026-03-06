import fastify from "fastify";
import type { GwrkConfig } from "../utils/config.js";
export declare function startServer(config: GwrkConfig, options?: {
    handleSignals?: boolean;
}): Promise<fastify.FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, fastify.FastifyBaseLogger, fastify.FastifyTypeProviderDefault>>;
