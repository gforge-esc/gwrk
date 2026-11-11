/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type AdapterDiscoveryReport,
  type DiscoveredModel,
  isConcreteModel,
} from "../../domain/model-qualification.js";
import {
  type AgentBackend,
  ModelDiscoveryError,
} from "../../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../../plugins/agent-registry.js";
import { PluginLoader } from "../../plugins/loader.js";
import type { ModelCatalogPort } from "../../ports/model-qualification-port.js";

const supportedBackends = [
  "agy",
  "claude",
  "codex",
  "cursor-agent",
  "opencode",
  "aider",
  "goose",
];

interface CatalogSource {
  adapter: Pick<
    AgentBackend,
    "isAvailable" | "discoverModels" | "supportsModelForwarding"
  >;
  manifest: {
    type: string;
    version: string;
    invocation?: { command: string };
  };
}

interface CatalogOptions {
  loadAgent?: (backend: string) => Promise<CatalogSource | null>;
  readVersion?: (command: string) => Promise<string>;
}

export function createModelCatalog(
  projectRoot: string,
  options: CatalogOptions = {},
): ModelCatalogPort {
  const loader = new PluginLoader({ projectDir: projectRoot });
  const registry = new AgentBackendRegistry(loader);
  const loadAgent =
    options.loadAgent ??
    (async (backend) => {
      const plugin = await loader.resolvePlugin(backend);
      if (plugin.manifest.type !== "agent") return null;
      return {
        manifest: plugin.manifest,
        adapter: await registry.getAgentBackend(backend),
      };
    });
  const readVersion =
    options.readVersion ??
    (async (command) => {
      const { stdout, stderr } = await promisify(execFile)(
        command,
        ["--version"],
        {
          cwd: projectRoot,
          timeout: 5_000,
          maxBuffer: 65_536,
        },
      );
      return (stdout.trim() || stderr.trim()).split("\n")[0] || "unknown";
    });

  return {
    async discoverCatalog({ scope, backends, explicitCandidates = [] }) {
      const names = [
        ...new Set(
          backends ?? [
            ...supportedBackends,
            ...(await loader.listPlugins({ type: "agent" })).map(
              ({ name }) => name,
            ),
            ...explicitCandidates.map(({ backend }) => backend),
          ],
        ),
      ].filter((backend) => backend !== "gemini");

      return Promise.all(
        names.map(async (backend): Promise<AdapterDiscoveryReport> => {
          let adapterVersion = "unknown";
          let cliVersion = "unknown";
          let supportsModelForwarding = false;
          try {
            if (
              scope.platform !== process.platform ||
              scope.arch !== process.arch
            ) {
              throw new Error("The catalog scope does not match this runner.");
            }
            const source = await loadAgent(backend);
            if (!source || source.manifest.type !== "agent") {
              throw new Error("Agent adapter is unavailable.");
            }
            adapterVersion = source.manifest.version;
            supportsModelForwarding =
              source.adapter.supportsModelForwarding === true;
            if (!(await source.adapter.isAvailable()))
              throw new Error("Agent CLI is unavailable.");
            const command = source.manifest.invocation?.command;
            if (command)
              cliVersion = await readVersion(command).catch(() => "unknown");
            const discovered = (await source.adapter.discoverModels?.()) ?? [];
            const candidates = discovered.length
              ? discovered
              : explicitCandidates;
            const models = new Map<string, DiscoveredModel>();
            for (const model of candidates) {
              if (
                model.backend !== backend ||
                model.hidden ||
                !isConcreteModel(model.modelId)
              )
                continue;
              models.set(model.modelId, model);
            }
            return {
              backend,
              cliVersion,
              adapterVersion,
              supportsModelForwarding,
              status: models.size > 0 ? "available" : "unconfigured",
              models: [...models.values()],
            };
          } catch (error) {
            return {
              backend,
              cliVersion,
              adapterVersion,
              supportsModelForwarding,
              status:
                error instanceof ModelDiscoveryError
                  ? error.status
                  : "unavailable",
              models: [],
              error:
                error instanceof ModelDiscoveryError
                  ? error.message
                  : "Model catalog unavailable on this runner.",
            };
          }
        }),
      );
    },
  };
}
