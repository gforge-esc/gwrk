/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  type AdapterDiscoveryReport,
  type JudgeVerdict,
  type ModelCandidate,
  type PromotionEvidence,
  assertNoSecretMaterial,
  blindCandidate,
  checkCandidate,
  evaluatePromotion,
  qualificationStaleness,
} from "./model-qualification.js";

const scope = {
  workspaceId: "workspace",
  runnerProfile: "local",
  platform: "linux",
  arch: "x64",
};
const candidate: ModelCandidate = {
  backend: "cli",
  provider: "provider-a",
  family: "frontier",
  modelId: "frontier-v3",
  effort: "high",
};
const snapshot = {
  scope,
  adapters: [
    {
      backend: "cli",
      status: "available",
      cliVersion: "3.0",
      adapterVersion: "1.2",
      supportsModelForwarding: true,
      models: [
        {
          ...candidate,
          supportedEfforts: ["high"],
          isDefault: false,
          hidden: false,
        },
      ],
    },
  ] satisfies AdapterDiscoveryReport[],
};
const judge = (provider: string, family: string): JudgeVerdict => ({
  judge: { backend: provider, provider, family, modelId: `${family}-v1` },
  observedJudgeModel: "unknown",
  winner: "B",
  optionARegression: false,
  optionBRegression: false,
  scores: { optionA: 80, optionB: 90 },
  citations: [
    {
      inputRef: "input",
      outputRef: "output",
      gateRef: "gate",
      claim: "The passing gate covers the required behavior.",
    },
  ],
});

const passingEvidence: PromotionEvidence = {
  candidateOption: "B",
  requiredFixtures: ["handoff"],
  repeats: [0, 1, 2].map((repeatIndex) => ({
    fixtureId: "handoff",
    repeatIndex,
    gatesPassed: true,
  })),
  judges: [judge("provider-a", "family-a"), judge("provider-b", "family-b")],
  refs: { input: ["input"], output: ["output"], gate: ["gate"] },
};

describe("model qualification policy", () => {
  it("checks the exact model, runner and effort against available catalog entries", () => {
    expect(checkCandidate(snapshot, scope, candidate)).toEqual({ ok: true });
    expect(
      checkCandidate(
        snapshot,
        { ...scope, runnerProfile: "hosted" },
        candidate,
      ),
    ).toMatchObject({ ok: false, reason: "runner-mismatch" });
    expect(
      checkCandidate(snapshot, scope, { ...candidate, effort: "low" }),
    ).toMatchObject({ ok: false, reason: "effort-unavailable" });
    expect(
      checkCandidate(snapshot, scope, { ...candidate, modelId: "auto" }),
    ).toMatchObject({ ok: false, reason: "model-alias" });
    const hidden = {
      ...snapshot,
      adapters: [
        {
          ...snapshot.adapters[0],
          models: [{ ...snapshot.adapters[0].models[0], hidden: true }],
        },
      ],
    };
    expect(checkCandidate(hidden, scope, candidate)).toMatchObject({
      ok: false,
      reason: "model-unavailable",
    });
  });

  it("keeps the incumbent after failed gates, dependent judges or unverifiable references", () => {
    const input = passingEvidence;
    expect(evaluatePromotion(input)).toEqual({ promote: true });
    expect(
      evaluatePromotion({ ...input, repeats: input.repeats.slice(0, 2) }),
    ).toMatchObject({ promote: false, reason: "insufficient-repeats" });
    expect(
      evaluatePromotion({
        ...input,
        repeats: input.repeats.map((r) => ({ ...r, gatesPassed: false })),
      }),
    ).toMatchObject({ promote: false, reason: "gate-failure" });
    expect(
      evaluatePromotion({
        ...input,
        judges: [
          judge("provider-a", "family-a"),
          judge("provider-a", "family-b"),
        ],
      }),
    ).toMatchObject({ promote: false, reason: "judge-dependence" });
    for (const unverifiedJudge of [
      judge("unknown", "family-b"),
      judge("provider-b", "unknown"),
    ]) {
      expect(
        evaluatePromotion({
          ...input,
          judges: [input.judges[0], unverifiedJudge],
        }),
      ).toMatchObject({ promote: false, reason: "judge-dependence" });
    }
    expect(
      evaluatePromotion({ ...input, refs: { ...input.refs, gate: [] } }),
    ).toMatchObject({ promote: false, reason: "invalid-citations" });
    expect(
      evaluatePromotion({
        ...input,
        judges: [input.judges[0], { ...input.judges[1], winner: "tie" }],
      }),
    ).toMatchObject({ promote: false, reason: "judge-non-regression" });
  });

  it("keeps the incumbent when persisted evidence has malformed decisions", () => {
    const invalidOption = {
      ...passingEvidence,
      candidateOption: "tie",
      judges: passingEvidence.judges.map((verdict) => ({
        ...verdict,
        winner: "tie",
      })),
    };
    const invalidGate = {
      ...passingEvidence,
      repeats: passingEvidence.repeats.map((repeat) => ({
        ...repeat,
        gatesPassed: "false",
      })),
    };
    const invalidJudge = (fields: Record<string, unknown>) => ({
      ...passingEvidence,
      judges: [
        { ...passingEvidence.judges[0], ...fields },
        passingEvidence.judges[1],
      ],
    });
    for (const invalid of [
      invalidOption,
      invalidGate,
      invalidJudge({ citations: null }),
      invalidJudge({ scores: null }),
      invalidJudge({ judge: null }),
    ]) {
      expect(
        evaluatePromotion(invalid as unknown as PromotionEvidence).promote,
      ).toBe(false);
    }
  });

  describe.each(["A", "B"] as const)("candidate %s", (candidateOption) => {
    const input = {
      ...passingEvidence,
      candidateOption,
      judges: passingEvidence.judges.map((verdict) => ({
        ...verdict,
        winner: candidateOption,
      })),
    };

    it.each(["unknown", "requested"] as const)(
      "accepts the %s observed judge model",
      (observation) => {
        const judges = input.judges.map((verdict) => ({
          ...verdict,
          observedJudgeModel:
            observation === "requested" ? verdict.judge.modelId : observation,
        }));
        expect(evaluatePromotion({ ...input, judges })).toEqual({
          promote: true,
        });
      },
    );

    it.each([
      "observedJudgeModel",
      "optionARegression",
      "optionBRegression",
    ] as const)("rejects an omitted %s", (field) => {
      const incomplete: Partial<(typeof input.judges)[number]> = {
        ...input.judges[1],
      };
      delete incomplete[field];
      expect(
        evaluatePromotion({
          ...input,
          judges: [input.judges[0], incomplete as JudgeVerdict],
        }),
      ).toEqual({
        promote: false,
        reason:
          field === "observedJudgeModel"
            ? "judge-dependence"
            : "judge-non-regression",
      });
    });

    it("rejects a candidate regression", () => {
      const verdict = {
        ...input.judges[1],
        optionARegression: candidateOption === "A",
        optionBRegression: candidateOption === "B",
      };
      expect(
        evaluatePromotion({ ...input, judges: [input.judges[0], verdict] }),
      ).toEqual({ promote: false, reason: "judge-non-regression" });
    });
  });

  it.each(["", " ", "different-model"])(
    "rejects an invalid observed judge model %j",
    (observedJudgeModel) => {
      const [first, second] = passingEvidence.judges;
      expect(
        evaluatePromotion({
          ...passingEvidence,
          judges: [first, { ...second, observedJudgeModel }],
        }),
      ).toEqual({ promote: false, reason: "judge-dependence" });
    },
  );

  it("expires evidence after effective prompt, fixture, tool or model changes", () => {
    const pinned = {
      fixtureSuiteHash: "fixtures",
      workflowPromptHashes: { define: "prompt", adr: "policy" },
      cliVersion: "3.0",
      adapterVersion: "1.2",
    };
    expect(
      qualificationStaleness(
        pinned,
        {
          ...pinned,
          workflowPromptHashes: { adr: "policy", define: "prompt" },
        },
        true,
      ),
    ).toEqual([]);
    expect(
      qualificationStaleness(
        pinned,
        {
          ...pinned,
          fixtureSuiteHash: "changed",
          workflowPromptHashes: { define: "prompt", adr: "new" },
          cliVersion: "4.0",
        },
        false,
      ),
    ).toEqual([
      "fixtures-changed",
      "prompts-changed",
      "tools-changed",
      "model-unavailable",
    ]);
  });

  it("assigns a stable blinded option from an injected secret and comparison identity", () => {
    const options = Array.from({ length: 16 }, (_, i) =>
      blindCandidate("fixture-key", `comparison-${i}`),
    );
    expect(new Set(options)).toEqual(new Set(["A", "B"]));
    expect(blindCandidate("fixture-key", "comparison-0")).toBe(options[0]);
  });

  it("rejects credentials without echoing their value", () => {
    expect(() =>
      assertNoSecretMaterial({ header: "Authorization: Bearer fixture-token" }),
    ).toThrow(/Secret material/);
    expect(() =>
      assertNoSecretMaterial({ key: "fixture-secret" }, ["fixture-secret"]),
    ).toThrow(/Secret material/);
    expect(() =>
      assertNoSecretMaterial({ contact: "person@example.invalid" }),
    ).toThrow(/Secret material/);
    expect(() =>
      assertNoSecretMaterial({ modelId: "frontier-v3", tokensIn: 42 }),
    ).not.toThrow();
  });

  it.each([
    "Cookie: session=fixture-session",
    "Authorization: Basic Zml4dHVyZQ==",
    "headers\nsEt-CoOkIe: session=fixture-session",
    "sk-fixture",
    "AIza1",
    "ghp_1",
    "gho_1",
    "ghu_1",
    "ghs_1",
    "ghr_1",
    "github_pat_1",
    "xoxb-1",
    "xoxa-1",
    "xoxp-1",
    "xoxr-1",
    "xoxs-1",
    "xapp-1",
  ])("rejects credential fixture %j", (value) => {
    expect(() => assertNoSecretMaterial({ value })).toThrow(
      "Secret material found in model qualification evidence.",
    );
  });

  it.each(["authorization", "Cookie", "SET-COOKIE"])(
    "rejects the structured header %s",
    (header) => {
      expect(() => assertNoSecretMaterial({ [header]: "fixture" })).toThrow(
        /Secret material/,
      );
    },
  );
});
