import type { FastifyInstance } from "fastify";
import { DispatchQueue } from "../dispatch.js";
export declare function dispatchRoutes(fastify: FastifyInstance, queue: DispatchQueue): Promise<void>;
