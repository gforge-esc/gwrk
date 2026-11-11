/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  AdapterDiscoveryReport,
  BlindedOption,
  DiscoveredModel,
  DiscoverySnapshot,
  ModelCandidate,
  ModelRole,
  RunnerScope,
} from "../domain/model-qualification.js";

export interface ModelCatalogPort {
  discoverCatalog(input: {
    scope: RunnerScope;
    backends?: readonly string[];
    explicitCandidates?: readonly DiscoveredModel[];
    nowIso: string;
  }): Promise<readonly AdapterDiscoveryReport[]>;
}

export interface SmokeProbeRequest {
  scope: RunnerScope;
  backend: string;
  modelId: string;
  effort?: string;
  timeoutMs: number;
}

export interface SmokeProbeEvidence {
  backend: string;
  requestedModel: string;
  requestedEffort?: string;
  observedModel: string;
  status: "passed" | "failed" | "timed_out" | "auth_error";
  schemaValid: boolean;
  exitCode: number;
  durationMs: number;
  error?: string;
}

export interface SmokeProbePort {
  runSmokeProbe(request: SmokeProbeRequest): Promise<SmokeProbeEvidence>;
}

export interface FixtureRepeatRequest {
  fixtureId: string;
  role: ModelRole;
  repeatIndex: number;
  route: {
    backend: string;
    modelId: string;
    effort?: string;
  };
  handoffArtifactDir?: string;
}

export interface FixtureRepeatEvidence {
  fixtureId: string;
  repeatIndex: number;
  requestedModel: string;
  observedModel: string;
  deterministicGatesPassed: boolean;
  gateChecks: readonly { checkId: string; passed: boolean; detail: string }[];
  durationMs: number;
  retries: number;
  usage?: { tokensIn?: number; tokensOut?: number; costUsd?: number };
  sanitizedOutput: string;
}

export interface QualificationRunnerPort {
  computeSuiteHashes(): Promise<{
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
  }>;
  runFixtureRepeat(
    request: FixtureRepeatRequest,
  ): Promise<FixtureRepeatEvidence>;
}

export interface JudgeVerdictPacket {
  comparisonId: string;
  role: ModelRole;
  fixtureSummary: string;
  optionA: string;
  optionB: string;
  gateEvidenceSummary: string;
}

export interface StructuredJudgeVerdict {
  judgeBackend: string;
  judgeProvider: string;
  judgeFamily: string;
  judgeModelId: string;
  observedJudgeModel: string;
  winner: BlindedOption | "tie";
  optionARegression: boolean;
  optionBRegression: boolean;
  scores: { optionA: number; optionB: number };
  citations: {
    inputRef: string;
    outputRef: string;
    gateRef: string;
    claim: string;
  }[];
}

export interface PromotionJudgePort {
  judgeComparison(
    judge: ModelCandidate,
    packet: JudgeVerdictPacket,
  ): Promise<StructuredJudgeVerdict>;
}

export interface RouteLockStorePort {
  writeDiscoverySnapshot(
    scope: RunnerScope,
    snapshot: DiscoverySnapshot,
  ): Promise<string>;
  readDiscoverySnapshot(scope: RunnerScope): Promise<DiscoverySnapshot | null>;
  writeEvaluationBundle(evaluationId: string, bundle: unknown): Promise<string>;
  readEvaluationBundle(evaluationId: string): Promise<unknown>;
  readRouteLock(
    scope: RunnerScope,
  ): Promise<{ digest: string; document: unknown } | null>;
  writeRouteLockAtomic(
    scope: RunnerScope,
    lock: unknown,
    expectedIncumbentDigest: string | null,
  ): Promise<
    { ok: true; digest: string } | { ok: false; reason: "incumbent-changed" }
  >;
}
