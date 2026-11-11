/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  type AdapterDiscoveryReport,
  type DiscoveredModel,
  type DiscoverySnapshot,
  type JudgeVerdict,
  type ModelCandidate,
  type PromotionEvidence,
  assertNoSecretMaterial,
  blindCandidate,
  checkCandidate,
  eligibleRoutesDigest,
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

  it("rejects flat credential headers decoded from fixture stdout", () => {
    const headers = [
      "Content-Type",
      "text/plain",
      "Set-Cookie",
      "session=fixture-only",
    ];
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput: `stdout: ${JSON.stringify(headers)}`,
      }),
    ).toThrow(/secret material/i);
  });

  it("allows Cookie as a Vary value in flat headers decoded from fixture stdout", () => {
    const headers = ["Content-Type", "text/plain", "Vary", "Cookie"];
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput: `stdout: ${JSON.stringify(headers)}`,
      }),
    ).not.toThrow();
  });

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

  describe.each<{ form: string; evidence: (response: unknown) => unknown }>([
    {
      form: "persisted evidence",
      evidence: (response) => JSON.parse(JSON.stringify({ response })),
    },
    {
      form: "fixture stdout",
      evidence: (response) => ({
        sanitizedOutput: `stdout: ${JSON.stringify({ response })}`,
      }),
    },
  ])("header values in $form", ({ evidence }) => {
    it.each([
      ["Cookie", "session=fixture-only", true],
      ["Content-Type", "text/plain", false],
    ] as const)(
      "checks %s in encoded response headers",
      (key, value, rejects) => {
        const encoded = JSON.stringify([{ key, value }]);
        for (const responseHeaders of [encoded, JSON.stringify(encoded)]) {
          const check = expect(() =>
            assertNoSecretMaterial(evidence({ responseHeaders })),
          );
          if (rejects) check.toThrow(/secret material/i);
          else check.not.toThrow();
        }
      },
    );

    it("rejects a credential tuple inside a general response array", () => {
      const response = [
        "fixture-response",
        ["Set-Cookie", "session=fixture-only"],
      ];
      expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
        /secret material/i,
      );
    });

    it.each([
      ["Cookie", "Accept-Encoding"],
      ["Accept-Encoding", "Cookie"],
    ])("allows standalone Vary field names %s and %s", (first, second) => {
      expect(() =>
        assertNoSecretMaterial(evidence(["vArY", [first, second]])),
      ).not.toThrow();
    });

    it("continues scanning a standalone Vary value for credential text", () => {
      expect(() =>
        assertNoSecretMaterial(
          evidence(["Vary", ["Cookie", "Bearer fixture-token"]]),
        ),
      ).toThrow(/secret material/i);
    });

    it("allows multi-value Vary in a flat header collection", () => {
      const response = { rawHeaders: ["Vary", ["Cookie", "Accept-Encoding"]] };
      expect(() => assertNoSecretMaterial(evidence(response))).not.toThrow();
    });

    it.each(["headers", "rawHeaders", "requestHeaders", "responseHeaders"])(
      "rejects a Cookie key in %s",
      (collection) => {
        const response = {
          [collection]: [{ key: "Cookie", value: "session=fixture-only" }],
        };
        expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
          /secret material/i,
        );
      },
    );

    describe.each(["requestHeaders", "responseHeaders", "headersDistinct"])(
      "%s maps",
      (collection) => {
        it.each([
          ["Cookie", "Accept-Encoding"],
          ["Accept-Encoding", "Cookie"],
        ])("allows Vary values %s and %s", (first, second) => {
          const response = { [collection]: { Vary: [first, second] } };
          expect(() =>
            assertNoSecretMaterial(evidence(response)),
          ).not.toThrow();
        });

        it("rejects a bearer token in a Vary value", () => {
          const response = {
            [collection]: {
              Vary: ["Accept-Encoding", "Bearer\tfixture-token"],
            },
          };
          expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
            /secret material/i,
          );
        });
      },
    );

    it("allows a Content-Type key in headers", () => {
      const response = {
        headers: [{ key: "Content-Type", value: "text/plain" }],
      };
      expect(() => assertNoSecretMaterial(evidence(response))).not.toThrow();
    });

    it.each(["headers", "rawHeaders"])(
      "rejects a singleton Cookie key in %s",
      (collection) => {
        const response = {
          [collection]: { key: "cOoKiE", value: "session=fixture-only" },
        };
        expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
          /secret material/i,
        );
      },
    );

    it.each([
      ["Cookie", "Accept-Encoding"],
      ["Accept-Encoding", "Cookie"],
    ])("allows singleton keyed Vary values %s and %s", (first, second) => {
      const response = { headers: { key: "Vary", value: [first, second] } };
      expect(() => assertNoSecretMaterial(evidence(response))).not.toThrow();
    });

    it.each([
      ["Cookie", "Accept-Encoding"],
      ["Accept-Encoding", "Cookie"],
    ])(
      "allows Vary values %s and %s in tuples and flat lists",
      (first, second) => {
        const values = [first, second];
        const response = {
          headers: [["Vary", values]],
          rawHeaders: ["Content-Type", "text/plain", "Vary", values],
        };
        expect(() => assertNoSecretMaterial(evidence(response))).not.toThrow();
      },
    );

    it.each([
      ["Cookie", "Accept-Encoding"],
      ["Accept-Encoding", "Cookie"],
    ])("allows Vary values %s and %s in maps and records", (first, second) => {
      const value = [first, second];
      for (const headers of [
        { vary: value },
        [{ name: "Vary", value }],
        [{ key: "Vary", value }],
      ]) {
        expect(() =>
          assertNoSecretMaterial(evidence({ headers })),
        ).not.toThrow();
      }
    });

    it("rejects credential material in header maps and records", () => {
      const value = ["Cookie", "Bearer\tfixture-token"];
      for (const headers of [
        { vary: value },
        [{ name: "Vary", value }],
        [{ key: "Vary", value }],
        { cookie: ["session=fixture-only"] },
      ]) {
        expect(() => assertNoSecretMaterial(evidence({ headers }))).toThrow(
          /secret material/i,
        );
      }
    });

    it("rejects a Cookie header after a multi-value Vary header", () => {
      const response = {
        headers: [
          ["Vary", ["Cookie", "Accept-Encoding"]],
          ["Cookie", "session=fixture-only"],
        ],
      };
      expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
        /secret material/i,
      );
    });

    it("rejects credential text in a multi-value header", () => {
      const response = {
        headers: [["Vary", ["Cookie", "Bearer\tfixture-token"]]],
      };
      expect(() => assertNoSecretMaterial(evidence(response))).toThrow(
        /secret material/i,
      );
    });
  });

  describe.each([
    {
      form: "persisted evidence",
      evidence: (tuples: unknown) =>
        JSON.parse(JSON.stringify({ response: tuples })),
    },
    {
      form: "fixture stdout",
      evidence: (tuples: unknown) => ({
        sanitizedOutput: `stdout: ${JSON.stringify(tuples)}`,
      }),
    },
  ])("standalone header tuples in $form", ({ evidence }) => {
    it.each([
      ["Cookie", "Accept-Encoding"],
      ["Accept-Encoding", "Cookie"],
    ])("allows Vary values %s and %s", (first, second) => {
      expect(() =>
        assertNoSecretMaterial(evidence([["Vary", [first, second]]])),
      ).not.toThrow();
    });

    it.each([
      ["Set-Cookie", "session=fixture-only"],
      ["Vary", ["Cookie", "Bearer\tfixture-token"]],
    ])("rejects credential material in a %s tuple", (name, value) => {
      expect(() => assertNoSecretMaterial(evidence([[name, value]]))).toThrow(
        /secret material/i,
      );
    });
  });

  it.each([
    ["Authorization", "Basic Zml4dHVyZQ=="],
    ["Cookie", "session=fixture-only"],
    ["sEt-CoOkIe", ["session=fixture-only", "theme=dark"]],
  ])("rejects a named %s header in persisted evidence", (name, value) => {
    const response = { headers: [{ name, value }] };
    const persisted = JSON.parse(JSON.stringify({ response }));
    expect(() => assertNoSecretMaterial(persisted)).toThrow(/secret material/i);
  });

  it("rejects a named Set-Cookie header in embedded JSON", () => {
    const response = {
      headers: [{ name: "Set-Cookie", value: "session=fixture-only" }],
    };
    const sanitizedOutput = `response: ${JSON.stringify({ response })}`;
    expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
      /secret material/i,
    );
  });

  it("allows a named Content-Type header in persisted and embedded evidence", () => {
    const response = {
      headers: [{ name: "Content-Type", value: "application/json" }],
    };
    const record = JSON.stringify({ response });
    expect(() => assertNoSecretMaterial(JSON.parse(record))).not.toThrow();
    expect(() =>
      assertNoSecretMaterial({ sanitizedOutput: `response: ${record}` }),
    ).not.toThrow();
  });

  describe.each<{
    shape: string;
    evidence: (header: { name: string; value: string }) => unknown;
  }>([
    {
      shape: "a persisted singleton",
      evidence: (header) =>
        JSON.parse(JSON.stringify({ response: { headers: header } })),
    },
    {
      shape: "an embedded top-level array",
      evidence: (header) => ({
        sanitizedOutput: `response headers: ${JSON.stringify([header])}`,
      }),
    },
    {
      shape: "embedded JSON in a property name",
      evidence: (header) => ({
        [JSON.stringify({ response: { headers: [header] } })]: true,
      }),
    },
  ])("named headers in $shape", ({ evidence }) => {
    it("rejects Set-Cookie", () => {
      const payload = evidence({
        name: "Set-Cookie",
        value: "session=fixture-only",
      });
      expect(() => assertNoSecretMaterial(payload)).toThrow(/secret material/i);
    });

    it("allows Content-Type", () => {
      const payload = evidence({
        name: "Content-Type",
        value: "application/json",
      });
      expect(() => assertNoSecretMaterial(payload)).not.toThrow();
    });
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

  it.each([
    { headers: { "Proxy-Authorization": "Basic Zml4dHVyZQ==" } },
    { rawHeaders: ["proxy-authorization", "Basic Zml4dHVyZQ=="] },
    { headers: [["Proxy-Authorization", "Basic Zml4dHVyZQ=="]] },
    { headers: [{ name: "Proxy-Authorization", value: "Basic Zml4dHVyZQ==" }] },
  ])("rejects proxy credentials in structured evidence %j", (evidence) => {
    expect(() => assertNoSecretMaterial(evidence)).toThrow(/secret material/i);
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput: JSON.stringify(
          JSON.stringify(JSON.stringify(evidence)),
        ),
      }),
    ).toThrow(/secret material/i);
  });

  it("allows noncredential proxy headers", () => {
    expect(() =>
      assertNoSecretMaterial({ rawHeaders: ["Proxy-Status", "fixture-proxy"] }),
    ).not.toThrow();
  });

  it("rejects Set-Cookie headers in doubly encoded JSON fixture output", () => {
    const payload = {
      headers: [{ name: "Set-Cookie", value: "session=fixture-only" }],
    };
    const sanitizedOutput = JSON.stringify(JSON.stringify(payload));
    expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
      /secret material/i,
    );
  });

  it("allows Content-Type headers in doubly encoded JSON fixture output", () => {
    const payload = {
      headers: [{ name: "Content-Type", value: "application/json" }],
    };
    const sanitizedOutput = JSON.stringify(JSON.stringify(payload));
    expect(() => assertNoSecretMaterial({ sanitizedOutput })).not.toThrow();
  });

  describe.each([
    ["a log prefix", (wrapped: string) => `fixture stdout: ${wrapped}`],
    ["a log suffix", (wrapped: string) => `${wrapped} fixture complete`],
    [
      "an unmatched log quote",
      (wrapped: string) => `stdout: "unterminated ${wrapped}`,
    ],
  ] as const)("doubly encoded JSON fixture output with %s", (_label, wrap) => {
    it("rejects Set-Cookie headers", () => {
      const wrapped = JSON.stringify(
        JSON.stringify({
          headers: [{ name: "Set-Cookie", value: "session=fixture-only" }],
        }),
      );
      expect(() =>
        assertNoSecretMaterial({ sanitizedOutput: wrap(wrapped) }),
      ).toThrow(/secret material/i);
    });

    it("allows Content-Type headers", () => {
      const wrapped = JSON.stringify(
        JSON.stringify({
          headers: [{ name: "Content-Type", value: "text/plain" }],
        }),
      );
      expect(() =>
        assertNoSecretMaterial({ sanitizedOutput: wrap(wrapped) }),
      ).not.toThrow();
    });
  });

  it("rejects a bare JSON record after a quoted log message", () => {
    const record = {
      headers: [{ name: "Set-Cookie", value: "session=fixture-only" }],
    };
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput: `stdout: "fixture output" ${JSON.stringify(record)}`,
      }),
    ).toThrow(/secret material/i);
  });

  describe("a bare JSON record after adjacent quoted log fragments", () => {
    const prefix = 'stdout: "first" "second ';

    it("rejects a Set-Cookie header pair", () => {
      const record = { headers: [["Set-Cookie", "session=fixture-only"]] };
      const sanitizedOutput = prefix + JSON.stringify(record);
      expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
        /secret material/i,
      );
    });

    it("allows a Content-Type header pair", () => {
      const record = { headers: [["Content-Type", "text/plain"]] };
      const sanitizedOutput = prefix + JSON.stringify(record);
      expect(() => assertNoSecretMaterial({ sanitizedOutput })).not.toThrow();
    });
  });

  it.each(["rawHeaders", String.raw`raw\u0048eaders`])(
    "rejects duplicate embedded header keys with spelling %s",
    (key) => {
      const sanitizedOutput = `response: {"rawHeaders":["Cookie","session=fixture-only"],"${key}":[]}`;
      expect(() => assertNoSecretMaterial({ sanitizedOutput })).toThrow(
        /duplicate object keys/i,
      );
    },
  );

  it("allows the same JSON key in separate embedded objects", () => {
    expect(() =>
      assertNoSecretMaterial({
        sanitizedOutput:
          'response: {"nested":[{"header":"first"},{"header":"second"}]}',
      }),
    ).not.toThrow();
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

  it("rejects conflicting identities for the same executable route", () => {
    const models = [
      { ...model, supportedEfforts: ["high"] },
      { ...model, family: "other-family", supportedEfforts: ["high"] },
    ];
    const catalog = (entries: typeof models) => ({
      ...snapshot,
      adapters: [{ ...report, models: entries }],
    });
    const route = { ...candidate, effort: "high" };
    expect(checkCandidate(catalog(models), scope, route)).toEqual({
      ok: false,
      reason: "model-unavailable",
    });
    expect(checkCandidate(catalog([models[0]]), scope, route)).toEqual({
      ok: true,
    });
    expect(
      checkCandidate(
        catalog([models[0], { ...models[1], supportedEfforts: ["low"] }]),
        scope,
        route,
      ),
    ).toEqual({ ok: true });
  });

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
      modelId: "openai/auto",
      concrete: false,
      expected: { ok: false, reason: "model-alias" },
    },
    {
      modelId: "anthropic/default",
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
    [
      "aggregator-cli",
      "aggregator-cli",
      "provider-a/model-v1",
      "provider-a/model-v1",
      { promote: false, reason: "judge-dependence" },
    ],
    [
      "aggregator-cli",
      "aggregator-cli",
      "provider-a/model-v1",
      "provider-b/model-v1",
      { promote: true },
    ],
    [
      "native-cli",
      "aggregator-cli",
      "provider-a/model-v1",
      "provider-a/model-v1",
      { promote: false, reason: "judge-dependence" },
    ],
    [
      "native-cli",
      "aggregator-cli",
      "provider-a/model-v1",
      "provider-b/model-v1",
      { promote: true },
    ],
    ["native-cli", "aggregator-cli", "model-v1", "model-v1", { promote: true }],
  ])(
    "checks judge independence on %s and %s with models %s and %s",
    (firstBackend, secondBackend, firstModelId, secondModelId, expected) => {
      const [first, second] = passingEvidence.judges;
      const input = JSON.parse(
        JSON.stringify({
          ...passingEvidence,
          judges: [
            {
              ...first,
              judge: {
                ...first.judge,
                backend: firstBackend,
                modelId: firstModelId,
              },
              observedJudgeModel: firstModelId,
            },
            {
              ...second,
              judge: {
                ...second.judge,
                backend: secondBackend,
                modelId: secondModelId,
              },
              observedJudgeModel: secondModelId,
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

  it("expires evidence when the eligible route digest changes", () => {
    const pinned = {
      fixtureSuiteHash: "fixtures",
      workflowPromptHashes: { define: "prompt" },
      cliVersion: "3.0",
      adapterVersion: "1.2",
      eligibleRoutesDigest: "previous-catalog-digest",
    };
    const current = { ...pinned, eligibleRoutesDigest: "new-catalog-digest" };

    expect(qualificationStaleness(pinned, current, true)).toEqual([
      "eligible-models-changed",
    ]);
  });

  describe("eligible catalog staleness", () => {
    const nextModel = { ...model, modelId: "frontier-v4" };
    const catalog = (...models: DiscoveredModel[]): DiscoverySnapshot => ({
      scope,
      adapters: [{ ...report, models }],
    });
    const fingerprint = (current: DiscoverySnapshot) => ({
      fixtureSuiteHash: "fixtures",
      workflowPromptHashes: { define: "prompt" },
      cliVersion: report.cliVersion,
      adapterVersion: report.adapterVersion,
      eligibleRoutesDigest: eligibleRoutesDigest(current, scope),
    });

    it.each([
      ["gains an eligible model", snapshot, catalog(model, nextModel)],
      ["loses an eligible model", catalog(model, nextModel), snapshot],
      [
        "changes a supported effort",
        catalog({ ...model, supportedEfforts: ["high", "low"] }),
        catalog({ ...model, supportedEfforts: ["high", "medium"] }),
      ],
    ])("expires evidence when the catalog %s", (_change, pinned, current) => {
      const modelAvailable = checkCandidate(current, scope, candidate).ok;
      expect(modelAvailable).toBe(true);
      expect(
        qualificationStaleness(
          fingerprint(pinned),
          fingerprint(current),
          modelAvailable,
        ),
      ).toEqual(["eligible-models-changed"]);
    });

    it("keeps evidence fresh after catalog entries are reordered", () => {
      const primaryReport = {
        ...report,
        models: [model, { ...nextModel, supportedEfforts: ["high", "low"] }],
      };
      const otherReport = {
        ...report,
        backend: "other-cli",
        models: [{ ...model, backend: "other-cli" }],
      };
      const pinned = { scope, adapters: [primaryReport, otherReport] };
      const current = {
        scope,
        adapters: [
          otherReport,
          {
            ...report,
            models: [
              { ...nextModel, supportedEfforts: ["low", "high"] },
              model,
            ],
          },
        ],
      };

      expect(
        qualificationStaleness(fingerprint(pinned), fingerprint(current), true),
      ).toEqual([]);
    });

    it("keeps evidence fresh when only ineligible routes are added", () => {
      const current = catalog(
        { ...model, supportedEfforts: ["high", "low\u0000"] },
        { ...nextModel, hidden: true },
        { ...nextModel, modelId: "provider-a/auto" },
      );

      expect(eligibleRoutesDigest(current, scope)).toBe(
        eligibleRoutesDigest(snapshot, scope),
      );
    });
  });

  it("expires evidence after effective prompt, fixture, tool or model changes", () => {
    const pinned = {
      fixtureSuiteHash: "fixtures",
      workflowPromptHashes: { define: "prompt", adr: "policy" },
      cliVersion: "3.0",
      adapterVersion: "1.2",
      eligibleRoutesDigest: eligibleRoutesDigest(snapshot, scope),
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
