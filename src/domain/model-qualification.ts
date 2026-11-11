/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, createHmac } from "node:crypto";

export type ModelRole = "define" | "implement" | "review";
export type BlindedOption = "A" | "B";

export interface RunnerScope {
  readonly workspaceId: string;
  readonly runnerProfile: string;
  readonly platform: string;
  readonly arch: string;
}

export interface ModelCandidate {
  readonly backend: string;
  readonly provider: string;
  readonly family: string;
  readonly modelId: string;
  readonly effort?: string;
}

export interface DiscoveredModel extends Omit<ModelCandidate, "effort"> {
  readonly supportedEfforts: readonly string[];
  readonly isDefault: boolean;
  readonly hidden: boolean;
}

export interface AdapterDiscoveryReport {
  readonly backend: string;
  readonly status:
    | "available"
    | "auth_error"
    | "rate_limited"
    | "unavailable"
    | "unconfigured";
  readonly cliVersion: string;
  readonly adapterVersion: string;
  readonly supportsModelForwarding: boolean;
  readonly models: readonly DiscoveredModel[];
  readonly error?: string;
}

export interface DiscoverySnapshot {
  readonly scope: RunnerScope;
  readonly adapters: readonly AdapterDiscoveryReport[];
}

type CandidateCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "runner-mismatch"
        | "model-alias"
        | "model-unavailable"
        | "effort-unavailable";
    };

export function isConcreteModel(modelId: string): boolean {
  return (
    typeof modelId === "string" &&
    !modelId.includes("\u0000") &&
    modelId === modelId.trim() &&
    Boolean(modelId) &&
    !/(?:^|\/)(?:auto|default|latest|unknown|opus|sonnet|haiku)$/i.test(modelId)
  );
}

function isCompleteRunnerScope(
  scope: RunnerScope | null | undefined,
): scope is RunnerScope {
  return (
    scope !== null &&
    scope !== undefined &&
    isNonBlankString(scope.workspaceId) &&
    isNonBlankString(scope.runnerProfile) &&
    isNonBlankString(scope.platform) &&
    isNonBlankString(scope.arch)
  );
}

export function checkCandidate(
  snapshot: DiscoverySnapshot,
  scope: RunnerScope,
  candidate: ModelCandidate,
): CandidateCheck {
  const snapshotScope = snapshot?.scope;
  if (
    !isCompleteRunnerScope(snapshotScope) ||
    !isCompleteRunnerScope(scope) ||
    snapshotScope.workspaceId !== scope.workspaceId ||
    snapshotScope.runnerProfile !== scope.runnerProfile ||
    snapshotScope.platform !== scope.platform ||
    snapshotScope.arch !== scope.arch
  ) {
    return { ok: false, reason: "runner-mismatch" };
  }
  if (!isNonBlankString(candidate?.backend))
    return { ok: false, reason: "model-unavailable" };
  if (!isConcreteModel(candidate.modelId))
    return { ok: false, reason: "model-alias" };
  if (
    !isNonBlankString(candidate.provider) ||
    !isNonBlankString(candidate.family) ||
    !Array.isArray(snapshot.adapters)
  )
    return { ok: false, reason: "model-unavailable" };
  const reports = snapshot.adapters.filter(
    (report) => report?.backend === candidate.backend,
  );
  const report: AdapterDiscoveryReport = reports[0];
  if (
    reports.length !== 1 ||
    report.status !== "available" ||
    report.supportsModelForwarding !== true ||
    !isNonBlankString(report.cliVersion) ||
    !isNonBlankString(report.adapterVersion) ||
    !Array.isArray(report.models)
  ) {
    return { ok: false, reason: "model-unavailable" };
  }
  const visibleModels: DiscoveredModel[] = report.models.filter(
    (model) =>
      model?.backend === candidate.backend &&
      model.modelId === candidate.modelId &&
      model.hidden === false,
  );
  const effort = candidate.effort;
  const routeMatches = visibleModels.filter(
    (model) =>
      effort === undefined ||
      (Array.isArray(model.supportedEfforts) &&
        model.supportedEfforts.includes(effort)),
  );
  if (routeMatches.length > 1)
    return { ok: false, reason: "model-unavailable" };

  const models = visibleModels.filter(
    (model) =>
      model.provider === candidate.provider &&
      model.family === candidate.family,
  );
  if (models.length !== 1) return { ok: false, reason: "model-unavailable" };
  const { isDefault, supportedEfforts } = models[0];
  if (
    typeof isDefault !== "boolean" ||
    !Array.isArray(supportedEfforts) ||
    supportedEfforts.some((effort) => typeof effort !== "string")
  ) {
    return { ok: false, reason: "model-unavailable" };
  }
  if (
    candidate.effort !== undefined &&
    (!isNonBlankString(candidate.effort) ||
      candidate.effort.includes("\u0000") ||
      !supportedEfforts.includes(candidate.effort))
  ) {
    return { ok: false, reason: "effort-unavailable" };
  }
  return { ok: true };
}

export function blindCandidate(
  key: string,
  comparisonId: string,
): BlindedOption {
  if (!key || !comparisonId)
    throw new Error("Blinding requires a key and comparison identity.");
  const digest = createHmac("sha256", key).update(comparisonId).digest();
  return (digest[0] & 1) === 0 ? "A" : "B";
}

export interface JudgeVerdict {
  readonly judge: ModelCandidate;
  readonly observedJudgeModel: string;
  readonly winner: BlindedOption | "tie";
  readonly optionARegression: boolean;
  readonly optionBRegression: boolean;
  readonly scores: { readonly optionA: number; readonly optionB: number };
  readonly citations: readonly {
    readonly inputRef: string;
    readonly outputRef: string;
    readonly gateRef: string;
    readonly claim: string;
  }[];
}

export interface PromotionEvidence {
  readonly candidateOption: BlindedOption;
  readonly requiredFixtures: readonly string[];
  readonly repeats: readonly {
    readonly fixtureId: string;
    readonly repeatIndex: number;
    readonly gatesPassed: boolean;
  }[];
  readonly judges: readonly JudgeVerdict[];
  readonly refs: {
    readonly input: readonly string[];
    readonly output: readonly string[];
    readonly gate: readonly string[];
  };
}

export type PromotionDecision =
  | { promote: true }
  | {
      promote: false;
      reason:
        | "gate-failure"
        | "insufficient-repeats"
        | "judge-dependence"
        | "invalid-citations"
        | "judge-non-regression";
    };

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function evaluatePromotion(input: PromotionEvidence): PromotionDecision {
  if (input.candidateOption !== "A" && input.candidateOption !== "B")
    return { promote: false, reason: "judge-non-regression" };
  if (
    !Array.isArray(input.repeats) ||
    input.repeats.some((repeat) => repeat?.gatesPassed !== true)
  )
    return { promote: false, reason: "gate-failure" };
  if (
    !Array.isArray(input.requiredFixtures) ||
    input.requiredFixtures.length === 0 ||
    input.requiredFixtures.some((fixture) => !isNonBlankString(fixture)) ||
    input.repeats.some(
      (repeat) =>
        !isNonBlankString(repeat.fixtureId) ||
        !Number.isSafeInteger(repeat.repeatIndex) ||
        repeat.repeatIndex < 0,
    ) ||
    input.requiredFixtures.some((fixture) => {
      const indices = new Set(
        input.repeats
          .filter((repeat) => repeat.fixtureId === fixture)
          .map((repeat) => repeat.repeatIndex),
      );
      return indices.size < 3;
    })
  ) {
    return { promote: false, reason: "insufficient-repeats" };
  }

  if (!Array.isArray(input.judges) || input.judges.length !== 2)
    return { promote: false, reason: "judge-dependence" };
  const normalize = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const providers = new Set(
    input.judges.map((verdict) => normalize(verdict?.judge?.provider)),
  );
  const families = new Set(
    input.judges.map((verdict) => normalize(verdict?.judge?.family)),
  );
  if (
    providers.size !== 2 ||
    families.size !== 2 ||
    providers.has("") ||
    families.has("") ||
    providers.has("unknown") ||
    families.has("unknown") ||
    input.judges.some(
      (verdict) =>
        !isNonBlankString(verdict?.judge?.backend) ||
        !isConcreteModel(verdict.judge.modelId) ||
        (verdict.observedJudgeModel !== "unknown" &&
          verdict.observedJudgeModel !== verdict.judge.modelId),
    )
  ) {
    return { promote: false, reason: "judge-dependence" };
  }
  const [{ judge: firstJudge }, { judge: secondJudge }] = input.judges;
  if (
    firstJudge.modelId === secondJudge.modelId &&
    (firstJudge.backend === secondJudge.backend ||
      /^[^/]+\/[^/]/.test(firstJudge.modelId))
  ) {
    return { promote: false, reason: "judge-dependence" };
  }

  if (
    !Array.isArray(input.refs?.input) ||
    !Array.isArray(input.refs?.output) ||
    !Array.isArray(input.refs?.gate)
  )
    return { promote: false, reason: "invalid-citations" };
  const refs = {
    input: new Set(input.refs.input),
    output: new Set(input.refs.output),
    gate: new Set(input.refs.gate),
  };
  if (
    input.judges.some(
      (verdict) =>
        !Array.isArray(verdict.citations) ||
        verdict.citations.length === 0 ||
        verdict.citations.some(
          (citation: JudgeVerdict["citations"][number]) =>
            !isNonBlankString(citation?.claim) ||
            !isNonBlankString(citation.inputRef) ||
            !isNonBlankString(citation.outputRef) ||
            !isNonBlankString(citation.gateRef) ||
            !refs.input.has(citation.inputRef) ||
            !refs.output.has(citation.outputRef) ||
            !refs.gate.has(citation.gateRef),
        ),
    )
  ) {
    return { promote: false, reason: "invalid-citations" };
  }

  const validScore = (score: unknown) =>
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100;
  if (
    input.judges.some(
      (verdict) =>
        verdict.winner !== input.candidateOption ||
        typeof verdict.optionARegression !== "boolean" ||
        typeof verdict.optionBRegression !== "boolean" ||
        (input.candidateOption === "A"
          ? verdict.optionARegression
          : verdict.optionBRegression) !== false ||
        !validScore(verdict.scores?.optionA) ||
        !validScore(verdict.scores?.optionB),
    )
  ) {
    return { promote: false, reason: "judge-non-regression" };
  }
  return { promote: true };
}

export function eligibleRoutesDigest(
  snapshot: DiscoverySnapshot,
  scope: RunnerScope,
): string {
  const routes = new Set<string>();
  if (Array.isArray(snapshot?.adapters)) {
    for (const adapter of snapshot.adapters) {
      if (!Array.isArray(adapter?.models)) continue;
      for (const model of adapter.models) {
        if (!Array.isArray(model?.supportedEfforts)) continue;
        const { backend, provider, family, modelId } = model;
        for (const effort of [undefined, ...model.supportedEfforts]) {
          const candidate = { backend, provider, family, modelId, effort };
          if (checkCandidate(snapshot, scope, candidate).ok) {
            routes.add(
              JSON.stringify([backend, provider, family, modelId, effort]),
            );
          }
        }
      }
    }
  }
  return createHash("sha256")
    .update(JSON.stringify([...routes].sort()))
    .digest("hex");
}

export interface QualificationFingerprint {
  readonly fixtureSuiteHash: string;
  readonly workflowPromptHashes: Readonly<Record<string, string>>;
  readonly cliVersion: string;
  readonly adapterVersion: string;
  readonly eligibleRoutesDigest: string;
}

type StalenessReason =
  | "fixtures-changed"
  | "prompts-changed"
  | "tools-changed"
  | "eligible-models-changed"
  | "model-unavailable";

export function qualificationStaleness(
  pinned: QualificationFingerprint,
  current: QualificationFingerprint,
  modelAvailable: boolean,
): StalenessReason[] {
  const reasons: StalenessReason[] = [];
  if (pinned.fixtureSuiteHash !== current.fixtureSuiteHash)
    reasons.push("fixtures-changed");
  const promptNames = new Set([
    ...Object.keys(pinned.workflowPromptHashes),
    ...Object.keys(current.workflowPromptHashes),
  ]);
  if (
    [...promptNames].some(
      (name) =>
        pinned.workflowPromptHashes[name] !==
        current.workflowPromptHashes[name],
    )
  )
    reasons.push("prompts-changed");
  if (
    pinned.cliVersion !== current.cliVersion ||
    pinned.adapterVersion !== current.adapterVersion
  )
    reasons.push("tools-changed");
  if (pinned.eligibleRoutesDigest !== current.eligibleRoutesDigest)
    reasons.push("eligible-models-changed");
  if (!modelAvailable) reasons.push("model-unavailable");
  return reasons;
}

const credentialHeaders =
  "(?:authorization|proxy-authorization|cookie|set-cookie)";
const secretMaterialMessage =
  "Secret material found in model qualification evidence.";
const secretPattern = new RegExp(
  String.raw`(?:^|[^a-z0-9])(?:bearer\s+[^\s"]+|sk-|AIza|gh[pousr]_|github_pat_|xox[baprs]-|xapp-)|"(?:${credentialHeaders}|api[_-]?key|access[_-]?token|password)"\s*:`,
  "i",
);
const mailboxPattern =
  /(?:[\p{L}\p{M}\p{N}!#$%&'*+/=?^_\x60{|}~.-]{1,64}|"(?:[^"\\\r\n]|\\.){0,64}")@(?:\[[^\]\r\n]{1,255}\]|(?:[\p{L}\p{M}\p{N}-]+\.)+[\p{L}][\p{L}\p{M}\p{N}-]*)/u;

function containsSensitiveText(text: string): boolean {
  return (
    secretPattern.test(text) ||
    (text.includes("@") && mailboxPattern.test(text))
  );
}

const headerPattern = new RegExp(
  String.raw`(?:\b${credentialHeaders}|(["'])${credentialHeaders}\1)[ \t]*:|(["'\x60])${credentialHeaders}\2\s*=>`,
  "i",
);
const credentialHeaderNamePattern = new RegExp(`^${credentialHeaders}$`, "i");
const headersKeyPattern =
  /^(?:(?:raw|request|response)?headers|headersDistinct)$/i;

function isCredentialHeaderName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    credentialHeaderNamePattern.test(stripTerminalControls(value))
  );
}

function isCredentialHeaderRecord(
  entry: unknown,
  nameField: "name" | "key",
): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "value" in entry &&
    nameField in entry &&
    isCredentialHeaderName(Reflect.get(entry, nameField))
  );
}

function hasHeaderName(entry: object): boolean {
  return ["name", "key"].some(
    (field) => typeof Reflect.get(entry, field) === "string",
  );
}

function isFlatHeaderList(entries: unknown[]): boolean {
  return (
    entries.length % 2 === 0 &&
    entries.every(
      (entry, index) =>
        typeof entry === "string" ||
        (index % 2 === 1 &&
          Array.isArray(entry) &&
          entry.every((value) => typeof value === "string")),
    )
  );
}

function isVaryFieldNameList(name: unknown, values: unknown[]): boolean {
  const fieldName = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
  return (
    typeof name === "string" &&
    name.toLowerCase() === "vary" &&
    values.length > 0 &&
    values.every((value) => typeof value === "string" && fieldName.test(value))
  );
}

function isStandaloneVaryTuple(entries: unknown[]): boolean {
  const [name, values] = entries;
  return (
    entries.length === 2 &&
    Array.isArray(values) &&
    isVaryFieldNameList(name, values)
  );
}

function isHeaderTupleList(entries: unknown[]): boolean {
  return (
    entries.length > 0 &&
    entries.every(
      (entry) =>
        Array.isArray(entry) && entry.length === 2 && isFlatHeaderList(entry),
    )
  );
}

function findJsonTokenEnd(text: string, start: number): number | undefined {
  let quote = text[start] === '"' ? '"' : null;
  const closers = quote ? [] : [text[start] === "{" ? "}" : "]"];
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) {
        if (closers.length === 0) return index + 1;
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === "\x60") {
      quote = char;
    } else if (char === "{" || char === "[") {
      closers.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (char !== closers.pop()) return undefined;
      if (closers.length === 0) return index + 1;
    }
  }
  return undefined;
}

// Normalize inspect's visible values before JSON parsing.
function inspectedRecordAsJson(token: string): string {
  const tokens =
    /("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\x60(?:[^\x60\\]|\\[\s\S])*\x60)(?:\.\.\. \d+ more characters?)?|([A-Za-z_$][\w$]*)(?=\s*:)|((?:,\s*)?(?:\.\.\. \d+ more items?(?=\s*(?:,\s*\[length\]\s*:|\]))|\[length\]\s*:\s*\d+(?=\s*\])))/g;
  const escapes: Record<string, string> = {
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  return token.replace(
    tokens,
    (
      _token,
      literal: string,
      key: string | undefined,
      omitted: string | undefined,
    ) => {
      if (omitted !== undefined) return "";
      return key !== undefined
        ? JSON.stringify(key)
        : JSON.stringify(
            literal
              .slice(1, -1)
              .replace(
                /\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|u\{([0-9a-f]{1,6})\}|([\s\S]))/gi,
                (_escape, hex, unit, point, char) => {
                  const digits = hex ?? unit ?? point;
                  return digits === undefined
                    ? (escapes[char] ?? char)
                    : String.fromCodePoint(Number.parseInt(digits, 16));
                },
              ),
          );
    },
  );
}

function isInspectedCredentialHeader(record: string): boolean {
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\](),]/g;
  const property = /\s*"(name|key|value)"\s*:\s*("(?:[^"\\]|\\[\s\S])*")?/y;
  const header: { name?: string; key?: string; value?: undefined } = {};
  let depth = 0;
  for (const token of record.matchAll(tokens)) {
    const [text] = token;
    if (text === "{" || text === "[" || text === "(") depth += 1;
    if (text === "}" || text === "]" || text === ")") depth -= 1;
    if (depth !== 1 || (text !== "{" && text !== ",")) continue;

    property.lastIndex = token.index + 1;
    const match = property.exec(record);
    if (!match) continue;
    const [, field, literal] = match;
    if (field === "value") {
      header.value = undefined;
    } else if ((field === "name" || field === "key") && literal) {
      const name = JSON.parse(literal) as string;
      if (isCredentialHeaderName(name)) header[field] = name;
    }
  }
  return (
    isCredentialHeaderRecord(header, "name") ||
    isCredentialHeaderRecord(header, "key")
  );
}

function assertUniqueJsonKeys(record: string): void {
  const tokens = /("(?:[^"\\]|\\.)*")(\s*:)?|[{}[\]]/g;
  const scopes: Array<Set<string> | null> = [];
  for (const [token, quoted, colon] of record.matchAll(tokens)) {
    if (token === "{") {
      scopes.push(new Set());
    } else if (token === "[") {
      scopes.push(null);
    } else if (token === "}" || token === "]") {
      scopes.pop();
    } else if (colon) {
      const keys = scopes.at(-1);
      const key = JSON.parse(quoted) as string;
      if (keys?.has(key)) {
        throw new Error(
          "Duplicate object keys in model qualification evidence.",
        );
      }
      keys?.add(key);
    }
  }
}

// Match terminal control sequences for formatting and hyperlinks in fixture logs.
const terminalControlPattern =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal escape bytes are intentional.
  /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)/g;

function stripTerminalControls(text: string): string {
  return text.replace(terminalControlPattern, "");
}

function scanEmbeddedJson(
  raw: string,
  knownSecrets: readonly string[],
  isHeaderCollection = false,
): void {
  const text = stripTerminalControls(raw);
  if (
    text !== raw &&
    (headerPattern.test(text) ||
      containsSensitiveText(text) ||
      knownSecrets.some((secret) => Boolean(secret) && text.includes(secret)))
  ) {
    throw new Error(secretMaterialMessage);
  }
  const openings = /["[{]/g;
  for (
    let opening = openings.exec(text);
    opening !== null;
    opening = openings.exec(text)
  ) {
    const end = findJsonTokenEnd(text, opening.index);
    if (end === undefined) continue;
    let token = text.slice(opening.index, end);
    let decoded: unknown;
    let inspectedObject: string | undefined;
    try {
      decoded = JSON.parse(token);
    } catch {
      if (!token.startsWith("[") && !token.startsWith("{")) continue;
      try {
        token = inspectedRecordAsJson(token);
        if (token.startsWith("{")) inspectedObject = token;
        decoded = JSON.parse(token);
        inspectedObject = undefined;
      } catch {
        if (inspectedObject === undefined) continue;
      }
    }
    if (inspectedObject !== undefined) {
      if (isInspectedCredentialHeader(inspectedObject)) {
        throw new Error(secretMaterialMessage);
      }
      continue;
    }
    if (typeof decoded !== "string") {
      assertUniqueJsonKeys(token);
      openings.lastIndex = end;
    }
    // Quoted log text can overlap the start of a JSON record.
    scanEvidence(decoded, knownSecrets, isHeaderCollection);
  }
}

export function assertNoSecretMaterial(
  value: unknown,
  knownSecrets: readonly string[] = [],
): void {
  scanEvidence(value, knownSecrets, false);
}

function scanEvidence(
  value: unknown,
  knownSecrets: readonly string[],
  rootIsHeaderCollection: boolean,
): void {
  let secretInText = false;
  let isRoot = true;
  const flatHeaderLists = new WeakSet<unknown[]>();
  const headerTupleParents = new WeakSet<unknown[]>();
  const headerMaps = new WeakSet<object>();
  const headerRecords = new WeakSet<object>();
  const serialized =
    JSON.stringify(value, function (this: unknown, key, entry: unknown) {
      const isHeaderCollection = isRoot
        ? rootIsHeaderCollection
        : headersKeyPattern.test(key);
      isRoot = false;
      const isFlatHeaderValue =
        Array.isArray(this) &&
        flatHeaderLists.has(this) &&
        Number(key) % 2 === 1;
      const isHeaderTupleOrRecord =
        Array.isArray(this) && headerTupleParents.has(this);
      const isStructuredHeaderValue =
        typeof this === "object" &&
        this !== null &&
        Array.isArray(entry) &&
        entry.every((value) => typeof value === "string") &&
        (headerMaps.has(this) ||
          (key === "value" &&
            (headerRecords.has(this) ||
              isVaryFieldNameList(Reflect.get(this, "name"), entry) ||
              isVaryFieldNameList(Reflect.get(this, "key"), entry))));
      const isHeaderValue = isFlatHeaderValue || isStructuredHeaderValue;
      if (Array.isArray(entry)) {
        // The same array can appear under both a header field and ordinary evidence.
        flatHeaderLists.delete(entry);
        headerTupleParents.delete(entry);
        if (!isHeaderValue) {
          if (isHeaderCollection || isHeaderTupleList(entry)) {
            headerTupleParents.add(entry);
          }
          if (
            ((isHeaderCollection || isHeaderTupleOrRecord) &&
              isFlatHeaderList(entry)) ||
            isStandaloneVaryTuple(entry)
          ) {
            flatHeaderLists.add(entry);
          }
        }
      } else if (typeof entry === "object" && entry !== null) {
        headerMaps.delete(entry);
        headerRecords.delete(entry);
        if (isHeaderCollection) headerMaps.add(entry);
        if (isHeaderTupleOrRecord && hasHeaderName(entry)) {
          headerRecords.add(entry);
        }
      }
      if (
        isCredentialHeaderName(key) ||
        headerPattern.test(key) ||
        containsSensitiveText(key) ||
        isCredentialHeaderRecord(entry, "name") ||
        isCredentialHeaderRecord(entry, "key") ||
        (typeof entry === "string" &&
          (headerPattern.test(entry) || containsSensitiveText(entry))) ||
        (Array.isArray(entry) &&
          !isHeaderValue &&
          entry.some(
            (header, index) =>
              index % 2 === 0 &&
              (index + 1 < entry.length || isHeaderCollection) &&
              isCredentialHeaderName(header),
          ))
      ) {
        secretInText = true;
      } else {
        scanEmbeddedJson(key, knownSecrets);
        if (typeof entry === "string") {
          scanEmbeddedJson(entry, knownSecrets, isHeaderCollection);
        }
      }
      return entry;
    }) ?? "";
  if (
    secretInText ||
    containsSensitiveText(serialized) ||
    knownSecrets.some(
      (secret) =>
        Boolean(secret) &&
        serialized.includes(JSON.stringify(secret).slice(1, -1)),
    )
  ) {
    throw new Error(secretMaterialMessage);
  }
}
