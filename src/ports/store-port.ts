/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  EnrolledProject,
  ProjectRoleBinding,
  SlackActionReceipt,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import type { CompressionReport } from "../domain/types.js";

export interface PlanFeatureNode {
  id: string;
  title: string;
  status: string;
  spTotal: number;
}

export interface PlanStorePort {
  initFromSpecs(
    specsDir: string,
  ): Promise<{ added: number; skipped: number; phases: number }>;
  renderToMarkdown(outputPath: string): Promise<void>;
  close(): void;
}

export interface RunEntry {
  id?: number;
  featureId: string;
  phaseId?: string;
  command: string;
  status: string;
}

export interface RunStorePort {
  recordCompression(report: CompressionReport, projectId: string): void;
  close(): void;
}

export interface ProjectRegistryPort {
  enrollProject(project: EnrolledProject): EnrolledProject;
  getProject(idOrAliasOrSlug: string): EnrolledProject | null;
  findByRepoSlug(repoSlug: string): EnrolledProject | null;
  findByLocalRoot(localRoot: string): EnrolledProject | null;
  listBySlackChannel(workspaceId: string, channelId: string): EnrolledProject[];
  listProjects(): EnrolledProject[];
  setRoleBinding(binding: ProjectRoleBinding): void;
  listRoleBindings(projectId: string): ProjectRoleBinding[];
  getFeatureThread(
    projectId: string,
    featureId: string,
  ): SlackFeatureThread | null;
  bindFeatureThread(thread: SlackFeatureThread): SlackFeatureThread;
  getActionReceipt(receiptKey: string): SlackActionReceipt | null;
  claimActionReceipt(receipt: SlackActionReceipt): boolean;
  completeActionReceipt(
    receiptKey: string,
    outcome: Exclude<SlackActionReceipt["outcome"], "claimed">,
  ): boolean;
  close(): void;
}
