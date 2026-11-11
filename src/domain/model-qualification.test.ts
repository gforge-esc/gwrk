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
  isConcreteModel,
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

describe("credential guard", () => {
  it.each(["ghp_", "sk-", "AIza", "xoxb-"])(
    "rejects the %s prefix inside underscore delimiters",
    (prefix) => {
      const token = `_${prefix}Fixture123_`;
      expect
        .soft(() => assertNoSecretMaterial({ output: token }))
        .toThrow(/secret material/i);
      expect
        .soft(() => assertNoSecretMaterial({ [token]: true }))
        .toThrow(/secret material/i);
    },
  );

  it.each([
    "Cookie: session=fixture-session",
    "Authorization: Basic Zml4dHVyZQ==",
    "sEt-CoOkIe: session=fixture-session",
    "Bearer\tfixture-token",
  ])("rejects credential text %j in a nested property name", (key) => {
    expect(() =>
      assertNoSecretMaterial(
        JSON.parse(JSON.stringify({ nested: [{ [key]: true }] })),
      ),
    ).toThrow(/secret material/i);
  });

  it.each([
    ["Authorization", "Basic Zml4dHVyZQ=="],
    ["Cookie", "session=fixture-session"],
    ["sEt-CoOkIe", "session=fixture-session"],
  ])("rejects a nested %s header pair", (name, value) => {
    expect(() =>
      assertNoSecretMaterial({ response: { headers: [[name, value]] } }),
    ).toThrow(/secret material/i);
  });

  it("allows a nested Content-Type header pair", () => {
    expect(() =>
      assertNoSecretMaterial({
        response: { headers: [["Content-Type", "application/json"]] },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      rawHeaders: ["Content-Type", "application/json", "Set-Cookie", "fixture"],
    },
    { headers: [["Set-Cookie", ["session=fixture", "theme=dark"]]] },
  ])(
    "rejects credential header structures %j from persisted evidence",
    (headers) => {
      const persisted = JSON.parse(JSON.stringify({ response: headers }));
      expect(() => assertNoSecretMaterial(persisted)).toThrow(
        /secret material/i,
      );
    },
  );

  it("allows ordinary flat headers and header arrays", () => {
    expect(() =>
      assertNoSecretMaterial({
        response: {
          rawHeaders: ["Content-Type", "application/json", "Vary", "Cookie"],
          headers: [["Vary", ["Accept", "Cookie"]]],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      headers: [["Set-Cookie", ["session=fixture", "theme=dark"]]],
    },
    {
      rawHeaders: [
        "Content-Type",
        "application/json",
        "Cookie",
        "session=fixture",
      ],
    },
  ])("rejects credential headers in JSON fixture output %j", (payload) => {
    expect(() =>
      assertNoSecretMaterial({ sanitizedOutput: JSON.stringify(payload) }),
    ).toThrow(/secret material/i);
  });

  it("allows Content-Type headers in JSON fixture output", () => {
    const sanitizedOutput = JSON.stringify({
      headers: [["Content-Type", "application/json"]],
      rawHeaders: ["Content-Type", "application/json"],
    });
    expect(() => assertNoSecretMaterial({ sanitizedOutput })).not.toThrow();
  });

  it("rejects Set-Cookie headers in fenced JSON fixture output", () => {
    const sanitizedOutput = [
      "Response headers",
      "```json",
      JSON.stringify({
        headers: [["Set-Cookie", ["session=fixture-only", "theme=dark"]]],
      }),
      "```",
    ].join("\n");

    expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
      /secret material/i,
    );
  });

  it("scans each fenced JSON block for credential headers", () => {
    const sanitizedOutput = [
      "```json",
      "{invalid JSON}",
      "```",
      "~~~JSON",
      JSON.stringify({ rawHeaders: ["Cookie", "session=fixture-only"] }),
      "~~~",
    ].join("\r\n");

    expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
      /secret material/i,
    );
  });

  it("allows Content-Type headers in fenced JSON fixture output", () => {
    const sanitizedOutput = [
      "```json",
      JSON.stringify({ headers: [["Content-Type", "application/json"]] }),
      "```",
    ].join("\n");

    expect(() => assertNoSecretMaterial({ sanitizedOutput })).not.toThrow();
  });

  describe.each([
    ["a log prefix", (record: string) => `response: ${record}`],
    [
      "a preceding JSON record",
      (record: string) => `{"type":"start"}\n${record}`,
    ],
    [
      "a fence with an info string",
      (record: string) =>
        ['```json title="response"', record, "```"].join("\n"),
    ],
  ] as const)("JSON fixture output with %s", (_label, wrap) => {
    it("rejects a Set-Cookie header in the embedded record", () => {
      const record = JSON.stringify({
        rawHeaders: [
          "Content-Type",
          "text/plain",
          "Set-Cookie",
          "session=fixture-session",
        ],
      });
      expect(() =>
        assertNoSecretMaterial({ sanitizedOutput: wrap(record) }),
      ).toThrow(/secret material/i);
    });

    it("allows a Content-Type header in the embedded record", () => {
      const record = JSON.stringify({
        rawHeaders: ["Content-Type", "text/plain"],
      });
      expect(() =>
        assertNoSecretMaterial({ sanitizedOutput: wrap(record) }),
      ).not.toThrow();
    });
  });

  it("finds an embedded JSON array after malformed text", () => {
    const record = JSON.stringify([
      { message: 'A literal ]} and an escaped quote " after a backslash \\' },
      { rawHeaders: ["Cookie", "session=fixture-session"] },
    ]);
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput: `invalid {"open [} ${record}`,
      }),
    ).toThrow(/secret material/i);
  });
});

describe("model qualification policy", () => {
  it.each(["high\u0000", "", " "])(
    "rejects an unusable persisted effort %j even when the catalog lists it",
    (effort) => {
      const persisted = JSON.parse(
        JSON.stringify({
          ...snapshot,
          adapters: [
            {
              ...report,
              models: [{ ...model, supportedEfforts: ["high", effort] }],
            },
          ],
        }),
      );

      expect(
        checkCandidate(persisted, scope, { ...candidate, effort }),
      ).toEqual({
        ok: false,
        reason: "effort-unavailable",
      });
      expect(
        checkCandidate(persisted, scope, { ...candidate, effort: "high" }),
      ).toEqual({
        ok: true,
      });
    },
  );

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

  const report = snapshot.adapters[0];
  const model = report.models[0];

  it.each([
    {
      modelId: "provider-a/model\u0000-v1",
      concrete: false,
      expected: { ok: false, reason: "model-alias" },
    },
    {
      modelId: "provider-a/model-v1",
      concrete: true,
      expected: { ok: true },
    },
  ])(
    "validates the persisted model ID $modelId",
    ({ modelId, concrete, expected }) => {
      const persisted = JSON.parse(
        JSON.stringify({
          candidate: { ...candidate, modelId },
          snapshot: {
            ...snapshot,
            adapters: [{ ...report, models: [{ ...model, modelId }] }],
          },
        }),
      );

      expect.soft(isConcreteModel(persisted.candidate.modelId)).toBe(concrete);
      expect(
        checkCandidate(persisted.snapshot, scope, persisted.candidate),
      ).toEqual(expected);
    },
  );

  describe.each(["snapshot", "requested"] as const)(
    "%s runner scope",
    (side) => {
      it.each([
        ["omitted scope", undefined],
        ["null scope", null],
        ["omitted workspace ID", { ...scope, workspaceId: undefined }],
        ["omitted runner profile", { ...scope, runnerProfile: undefined }],
        ["omitted platform", { ...scope, platform: undefined }],
        ["omitted architecture", { ...scope, arch: undefined }],
        ["blank runner profile", { ...scope, runnerProfile: " " }],
        ["numeric workspace ID", { ...scope, workspaceId: 42 }],
      ])("rejects %s in persisted input", (_label, invalidScope) => {
        const input = JSON.parse(
          JSON.stringify({
            snapshot: {
              ...snapshot,
              scope: side === "snapshot" ? invalidScope : scope,
            },
            scope: side === "requested" ? invalidScope : scope,
          }),
        );
        expect(checkCandidate(input.snapshot, input.scope, candidate)).toEqual({
          ok: false,
          reason: "runner-mismatch",
        });
      });
    },
  );

  it.each([
    ["empty scopes", {}],
    ["omitted workspace ID", { ...scope, workspaceId: undefined }],
    ["omitted runner profile", { ...scope, runnerProfile: undefined }],
    ["omitted platform", { ...scope, platform: undefined }],
    ["omitted architecture", { ...scope, arch: undefined }],
    ["blank runner profile", { ...scope, runnerProfile: " " }],
    ["numeric workspace ID", { ...scope, workspaceId: 42 }],
  ])("rejects matching persisted scopes with %s", (_label, invalidScope) => {
    const input = JSON.parse(
      JSON.stringify({
        snapshot: { ...snapshot, scope: invalidScope },
        scope: invalidScope,
      }),
    );
    expect(checkCandidate(input.snapshot, input.scope, candidate)).toEqual({
      ok: false,
      reason: "runner-mismatch",
    });
  });

  it("rejects a persisted null candidate", () => {
    expect(checkCandidate(snapshot, scope, JSON.parse("null"))).toEqual({
      ok: false,
      reason: "model-unavailable",
    });
  });

  describe.each(["backend", "provider", "family"] as const)(
    "model %s",
    (field) => {
      it.each([undefined, " "])(
        "rejects matching identities with persisted value %j",
        (value) => {
          const input = JSON.parse(
            JSON.stringify({
              snapshot: {
                ...snapshot,
                adapters: [
                  {
                    ...report,
                    ...(field === "backend" ? { backend: value } : {}),
                    models: [{ ...model, [field]: value }],
                  },
                ],
              },
              candidate: { ...candidate, [field]: value },
            }),
          );
          expect(
            checkCandidate(input.snapshot, scope, input.candidate),
          ).toEqual({
            ok: false,
            reason: "model-unavailable",
          });
        },
      );
    },
  );

  it.each([
    ["omitted CLI version", [{ ...report, cliVersion: undefined }]],
    ["blank CLI version", [{ ...report, cliVersion: " " }]],
    ["numeric CLI version", [{ ...report, cliVersion: 3 }]],
    ["omitted adapter version", [{ ...report, adapterVersion: undefined }]],
    ["blank adapter version", [{ ...report, adapterVersion: " " }]],
    ["numeric adapter version", [{ ...report, adapterVersion: 1 }]],
    [
      "omitted default flag",
      [{ ...report, models: [{ ...model, isDefault: undefined }] }],
    ],
    [
      "string default flag",
      [{ ...report, models: [{ ...model, isDefault: "false" }] }],
    ],
    ["null model list", [{ ...report, models: null }]],
    ["null adapter list", null],
    ["null adapter entry", [null]],
    ["null model entry", [{ ...report, models: [null] }]],
  ])("rejects a persisted catalog with %s", (_field, adapters) => {
    const persisted = JSON.parse(JSON.stringify({ scope, adapters }));
    expect(checkCandidate(persisted, scope, candidate)).toEqual({
      ok: false,
      reason: "model-unavailable",
    });
  });

  it.each([
    {
      field: "string model forwarding",
      report: { ...report, supportsModelForwarding: "false" },
      route: candidate,
    },
    {
      field: "omitted hidden flag",
      report: { ...report, models: [{ ...model, hidden: undefined }] },
      route: candidate,
    },
    {
      field: "string effort list",
      report: {
        ...report,
        models: [{ ...model, supportedEfforts: "highlight" }],
      },
      route: candidate,
    },
    {
      field: "omitted effort list with a requested effort",
      report: {
        ...report,
        models: [{ ...model, supportedEfforts: undefined }],
      },
      route: candidate,
    },
    {
      field: "omitted effort list without a requested effort",
      report: {
        ...report,
        models: [{ ...model, supportedEfforts: undefined }],
      },
      route: { ...candidate, effort: undefined },
    },
    {
      field: "non-string effort entry",
      report: {
        ...report,
        models: [{ ...model, supportedEfforts: ["high", 1] }],
      },
      route: candidate,
    },
  ])("rejects a persisted catalog with $field", ({ report, route }) => {
    const persisted = JSON.parse(JSON.stringify({ scope, adapters: [report] }));
    expect(checkCandidate(persisted, scope, route)).toEqual({
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

  it.each(["", " ", null, 42])(
    "rejects a persisted required fixture ID of %j even with three matching repeats",
    (fixtureId) => {
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          requiredFixtures: [fixtureId],
          repeats: passingEvidence.repeats.map((repeat) => ({
            ...repeat,
            fixtureId,
          })),
        }),
      );
      expect(evaluatePromotion(input)).toEqual({
        promote: false,
        reason: "insufficient-repeats",
      });
    },
  );

  it.each(["", " ", null, 42])(
    "rejects a persisted repeat fixture ID of %j even when required repeats pass",
    (fixtureId) => {
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          repeats: [
            ...passingEvidence.repeats,
            { fixtureId, repeatIndex: 0, gatesPassed: true },
          ],
        }),
      );
      expect(evaluatePromotion(input)).toEqual({
        promote: false,
        reason: "insufficient-repeats",
      });
    },
  );

  it.each([undefined, "", " ", null, 42])(
    "rejects a persisted judge backend of %j",
    (backend) => {
      const [first, second] = passingEvidence.judges;
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          judges: [first, { ...second, judge: { ...second.judge, backend } }],
        }),
      );
      expect(evaluatePromotion(input)).toEqual({
        promote: false,
        reason: "judge-dependence",
      });
    },
  );

  it.each([
    ["provider-a/model-v1", { promote: false, reason: "judge-dependence" }],
    ["provider-b/model-v1", { promote: true }],
  ])(
    "checks judge independence on a shared backend with second model %s",
    (modelId, expected) => {
      const [first, second] = passingEvidence.judges;
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          judges: [
            {
              ...first,
              judge: {
                ...first.judge,
                backend: "aggregator",
                modelId: "provider-a/model-v1",
              },
              observedJudgeModel: "provider-a/model-v1",
            },
            {
              ...second,
              judge: { ...second.judge, backend: "aggregator", modelId },
              observedJudgeModel: modelId,
            },
          ],
        }),
      );
      expect(evaluatePromotion(input)).toEqual(expected);
    },
  );

  describe.each(["input", "output", "gate"] as const)("%s citation", (kind) => {
    it.each([null, "", " ", 42])(
      "rejects a persisted reference of %j even when the artifact matches",
      (ref) => {
        const [first, second] = passingEvidence.judges;
        const citation = { ...second.citations[0], [`${kind}Ref`]: ref };
        const input = JSON.parse(
          JSON.stringify({
            ...passingEvidence,
            judges: [first, { ...second, citations: [citation] }],
            refs: {
              ...passingEvidence.refs,
              [kind]: [...passingEvidence.refs[kind], ref],
            },
          }),
        );
        expect(evaluatePromotion(input)).toEqual({
          promote: false,
          reason: "invalid-citations",
        });
      },
    );
  });

  it.each([undefined, "3", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects persisted repeat index %s even with three valid repeats",
    (repeatIndex) => {
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          repeats: [
            ...passingEvidence.repeats,
            { fixtureId: "handoff", repeatIndex, gatesPassed: true },
          ],
        }),
      );
      expect(evaluatePromotion(input)).toEqual({
        promote: false,
        reason: "insufficient-repeats",
      });
    },
  );

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
