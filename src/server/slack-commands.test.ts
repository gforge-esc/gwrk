/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ChildProcess, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  type Mocked,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import {
  SYNTHETIC_CHANNEL_ALPHA,
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_ROLES,
  SYNTHETIC_THREAD_ALPHA,
  SYNTHETIC_USER_MAINTAINER,
  SYNTHETIC_USER_OPERATOR,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
  createSyntheticVcsPort,
} from "../../tests/helpers/synthetic-slack.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { createProjectRoutingService } from "../application/project-routing/index.js";
import { findOpenPr } from "../db/runs.js";
import type { DispatchQueue } from "./dispatch.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import {
  type CommandContext,
  buildSlackLogResponse,
  handleSlashCommand,
} from "./slack-commands.js";

// Mock findOpenPr for approve command
vi.mock("../db/runs.js", () => ({
  findOpenPr: vi.fn().mockReturnValue({
    pr_number: 42,
    pr_url: "https://github.com/test/pr/42",
  }),
  listRuns: vi.fn().mockReturnValue([]),
  getStats: vi.fn().mockReturnValue([]),
}));

// Mock execSync for gh pr merge
vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return {
    ...mod,
    execSync: vi.fn().mockReturnValue("Merged PR #42"),
    spawn: vi.fn().mockReturnValue({ unref: vi.fn() }),
  };
});

function initCheckout(
  project: typeof SYNTHETIC_PROJECT_ALPHA,
  root: string,
  bare = false,
) {
  mkdirSync(root, { recursive: true });
  const options = { cwd: root, stdio: "ignore" as const, timeout: 5_000 };
  execFileSync(
    "git",
    bare ? ["init", "--quiet", "--bare"] : ["init", "--quiet"],
    options,
  );
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${project.repoSlug}.git`],
    options,
  );
  return { ...project, localRoot: root, projectId: resolveProjectId(root) };
}

function registryFor(
  alpha: typeof SYNTHETIC_PROJECT_ALPHA,
  beta = SYNTHETIC_PROJECT_BETA,
) {
  return createSyntheticRegistry({
    projects: [alpha, beta],
    roles: SYNTHETIC_ROLES.map((role) => ({
      ...role,
      projectId:
        role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId
          ? alpha.projectId
          : beta.projectId,
    })),
    threads: [{ ...SYNTHETIC_THREAD_ALPHA, projectId: alpha.projectId }],
  });
}

const proposedAdr = `# ADR-010: Track the decision

> **Status:** Proposed
> **Date:** 2026-01-01
> **Decision:** Track the decision in the index.
> **Decision Scope:** Slack
`;

describe("slack-commands (FR-015, US-004)", () => {
  let mockQueue: Mocked<DispatchQueue>;
  let mockMonitor: Mocked<SystemMonitor>;
  let mockGit: Mocked<GitManager>;
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueue = {
      getQueue: vi.fn().mockReturnValue({
        active: [],
        queued: [],
        throttled: false,
        paused: false,
      }),
      getDispatch: vi.fn(),
      enqueue: vi.fn(),
      pause: vi.fn(),
    } as unknown as Mocked<DispatchQueue>;
    mockMonitor = {
      getResources: vi.fn().mockReturnValue({
        cpuPercent: 10,
        memPercent: 20,
        diskFreeGb: 100,
      }),
    } as unknown as Mocked<SystemMonitor>;
    mockGit = {
      mergePhaseBack: vi.fn(),
    } as unknown as Mocked<GitManager>;

    const root = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-slash-")));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const alpha = initCheckout(SYNTHETIC_PROJECT_ALPHA, root);
    mkdirSync(join(root, "specs", SYNTHETIC_THREAD_ALPHA.featureId), {
      recursive: true,
    });
    const registry = registryFor(alpha);
    const routingService = createProjectRoutingService({ registry });
    const mockVcs = createSyntheticVcsPort();

    context = {
      userId: SYNTHETIC_USER_MAINTAINER,
      channelId: SYNTHETIC_CHANNEL_ALPHA,
      workspaceId: SYNTHETIC_WORKSPACE_ID,
      projectRoot: root,
      buildServerUrl: "http://localhost:3000",
      queue: mockQueue,
      queueProjectId: alpha.projectId,
      monitor: mockMonitor,
      git: mockGit,
      routingService,
      vcs: mockVcs,
    };
  });

  it("returns ephemeral REMOTE_AUTH_REQUIRED denial and runs no side effect when routingService is undefined", async () => {
    const { spawn } = await import("node:child_process");
    const merge = vi.spyOn(context.vcs!, "mergePullRequest");
    const contextWithoutRouting: CommandContext = {
      ...context,
      routingService: undefined,
    };
    const response = await handleSlashCommand(
      "dispatch 003-slack 3",
      contextWithoutRouting,
    );
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toContain("REMOTE_AUTH_REQUIRED");
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  });

  it("handles status command without args", async () => {
    const response = await handleSlashCommand("status", context);
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toMatch(
      /\*System Resources:\* CPU 10(\.0)?%, MEM 20(\.0)?%/,
    );
  });

  it("handles status command with feature ID", async () => {
    mockQueue.getDispatch.mockReturnValue({
      featureId: "003-slack",
      status: "running",
      phaseId: "phase-04",
    });
    const response = await handleSlashCommand("status 003-slack", context);
    expect(response.blocks[1].text.text).toContain(
      "*Feature 003-slack:* running (phase-04)",
    );
  });

  it.each(["local", "feature", "file"])(
    "scopes status and effort to the authorized checkout for %s paths",
    async (boundary) => {
      const root = mkdtempSync(join(tmpdir(), "gwrk-slash-feature-scope-"));
      vi.stubEnv("GWRK_HOME", join(root, "home"));
      onTestFinished(() => {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
      });
      const alpha = initCheckout(SYNTHETIC_PROJECT_ALPHA, join(root, "alpha"));
      const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
      const featureId = "001-scoped";
      const run = ".gwrk/runs/phase-01.json";
      const alphaFeature = join(alpha.localRoot, "specs", featureId);
      const betaFeature = join(beta.localRoot, "specs", featureId);
      mkdirSync(join(betaFeature, ".gwrk/runs"), { recursive: true });
      writeFileSync(join(betaFeature, run), "{}");
      writeFileSync(
        join(betaFeature, "spec.md"),
        "### US-001 Foreign story [19 SP]\n",
      );
      mkdirSync(join(alpha.localRoot, "specs"), { recursive: true });
      writeFileSync(
        join(alpha.localRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: alpha.name } }),
      );
      if (boundary === "feature") {
        symlinkSync(betaFeature, alphaFeature, "dir");
      } else {
        mkdirSync(join(alphaFeature, ".gwrk/runs"), { recursive: true });
        if (boundary === "file") {
          symlinkSync(join(betaFeature, run), join(alphaFeature, run));
          symlinkSync(
            join(betaFeature, "spec.md"),
            join(alphaFeature, "spec.md"),
          );
        } else {
          writeFileSync(join(alphaFeature, run), "{}");
          writeFileSync(
            join(alphaFeature, "spec.md"),
            "### US-001 Local story [5 SP]\n",
          );
        }
      }
      const scopedContext = {
        ...context,
        userId: SYNTHETIC_USER_VIEWER,
        projectRoot: beta.localRoot,
        routingService: createProjectRoutingService({
          registry: registryFor(alpha, beta),
        }),
      };
      const status = await handleSlashCommand(
        `status ${featureId}`,
        scopedContext,
      );
      const effort = await handleSlashCommand(
        `effort ${featureId}`,
        scopedContext,
      );
      const statusBlocks = JSON.stringify(status.blocks);
      const effortBlocks = JSON.stringify(effort.blocks);
      if (boundary === "local") {
        expect(statusBlocks).toContain(
          "Ship runs on disk:* 1 (latest: `phase-01.json`)",
        );
        expect(effortBlocks).toContain("Total Story Points: 5");
      } else {
        expect(statusBlocks).toContain("No dispatch runs found");
        expect(statusBlocks).not.toContain("phase-01.json");
        expect(effortBlocks).toContain("Feature specification is unavailable");
      }
    },
  );

  it("rejects logs and skips thread lookup when another repository replaces the enrolled checkout", async () => {
    const root = context.projectRoot;
    const alpha = initCheckout(SYNTHETIC_PROJECT_ALPHA, join(root, "alpha"));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const runs = join(beta.localRoot, "specs", featureId, ".gwrk/runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      join(runs, "beta-run.json"),
      JSON.stringify({ gate_result: "Beta private gate" }),
    );
    renameSync(alpha.localRoot, join(root, "saved-alpha"));
    renameSync(beta.localRoot, alpha.localRoot);

    const registry = registryFor(alpha, beta);
    const getThread = vi.spyOn(registry, "getFeatureThread");
    const scopedContext = {
      ...context,
      routingService: createProjectRoutingService({ registry }),
    };
    const logs = await handleSlashCommand(`logs ${featureId}`, scopedContext);
    expect.soft(logs.response_type).toBe("ephemeral");
    expect
      .soft(JSON.stringify(logs.blocks))
      .toContain("checkout is unavailable");
    expect.soft(JSON.stringify(logs.blocks)).not.toContain("Beta private gate");
    expect.soft(logs.thread_ts).toBeUndefined();

    const status = await handleSlashCommand(
      `status ${featureId}`,
      scopedContext,
    );
    expect
      .soft(JSON.stringify(status.blocks))
      .toContain("No dispatch runs found");
    expect.soft(JSON.stringify(status.blocks)).not.toContain("beta-run.json");
    expect(getThread).not.toHaveBeenCalled();
  });

  it("uses a verified mirror for logs and refuses dispatch through a replaced queue checkout", async () => {
    const root = context.projectRoot;
    const alpha = initCheckout(SYNTHETIC_PROJECT_ALPHA, join(root, "alpha"));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const mirror = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha.git"),
      true,
    );
    const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
    const runs = join(mirror.localRoot, "specs", featureId, ".gwrk/runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      join(runs, "mirror-run.json"),
      JSON.stringify({ gate_result: "Alpha mirror gate" }),
    );
    renameSync(alpha.localRoot, join(root, "saved-alpha"));
    renameSync(beta.localRoot, alpha.localRoot);
    mkdirSync(join(alpha.localRoot, "specs", featureId), { recursive: true });
    const scopedContext = {
      ...context,
      projectRoot: alpha.localRoot,
      queueProjectId: alpha.projectId,
      routingService: createProjectRoutingService({
        registry: registryFor({ ...alpha, mirrorPath: mirror.localRoot }),
      }),
    };

    const logs = await handleSlashCommand("logs 003", scopedContext);
    expect.soft(JSON.stringify(logs.blocks)).toContain("Alpha mirror gate");
    expect.soft(logs.thread_ts).toBe(SYNTHETIC_THREAD_ALPHA.rootTs);
    const dispatch = await handleSlashCommand(
      `dispatch ${featureId} 3`,
      scopedContext,
    );
    expect.soft(dispatch.response_type).toBe("ephemeral");
    expect
      .soft(JSON.stringify(dispatch.blocks))
      .toContain("checkout is unavailable");
    expect.soft(dispatch.thread_ts).toBe(SYNTHETIC_THREAD_ALPHA.rootTs);
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it.each(["dispatch 003-slack 3", "approve 003-slack phase-01"])(
    "threads %s in the bound Slack conversation",
    async (command) => {
      const response = await handleSlashCommand(command, context);
      expect(response.thread_ts).toBe(SYNTHETIC_THREAD_ALPHA.rootTs);
    },
  );

  it("keeps a feature command in its direct message instead of using the project channel thread", async () => {
    const response = await handleSlashCommand(
      "dispatch 003-slack 3 --project alpha",
      {
        ...context,
        channelId: "D123",
      },
    );
    expect(response.response_type).toBe("in_channel");
    expect(response.thread_ts).toBeUndefined();
  });

  it("handles dispatch command with feature and phase", async () => {
    const response = await handleSlashCommand("dispatch 003-slack 3", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain(
      "Dispatching feature *003-slack*",
    );
    expect(mockQueue.enqueue).toHaveBeenCalledWith({
      featureId: "003-slack",
      phaseId: "phase-03",
    });
  });

  it.each(["dispatch", "define", "ship"])(
    "refuses %s for a feature linked to another checkout",
    async (command) => {
      const { spawn } = await import("node:child_process");
      const root = mkdtempSync(join(tmpdir(), "gwrk-slash-linked-feature-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
      const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
      const foreignFeature = join(beta.localRoot, "specs", featureId);
      const localFeature = join(context.projectRoot, "specs", featureId);
      mkdirSync(foreignFeature, { recursive: true });
      renameSync(localFeature, join(root, "saved-alpha-feature"));
      symlinkSync(foreignFeature, localFeature, "dir");

      const args = command === "define" ? "spec" : "1";
      const response = await handleSlashCommand(
        `${command} ${featureId} ${args}`,
        context,
      );

      expect.soft(response.response_type).toBe("ephemeral");
      expect.soft(mockQueue.enqueue).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it.each(["ship", "approve"])(
    "keeps foreign feature names out of %s replies when specs links to another checkout",
    async (command) => {
      const { spawn } = await import("node:child_process");
      const merge = vi.spyOn(context.vcs!, "mergePullRequest");
      const root = mkdtempSync(join(tmpdir(), "gwrk-slash-linked-specs-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
      const foreignSpecs = join(beta.localRoot, "specs");
      const localSpecs = join(context.projectRoot, "specs");
      mkdirSync(join(foreignSpecs, "004-beta-private"), { recursive: true });
      renameSync(localSpecs, join(root, "saved-alpha-specs"));
      symlinkSync(foreignSpecs, localSpecs, "dir");

      const response = await handleSlashCommand(
        `${command} 003-slack 1`,
        context,
      );
      const reply = JSON.stringify(response.blocks);

      expect.soft(response.response_type).toBe("ephemeral");
      expect
        .soft(reply)
        .toContain("Feature is unavailable inside this project's checkout.");
      expect.soft(reply).not.toContain("004-beta-private");
      expect.soft(reply).not.toContain("Available features");
      expect.soft(spawn).not.toHaveBeenCalled();
      expect.soft(findOpenPr).not.toHaveBeenCalled();
      expect(merge).not.toHaveBeenCalled();
    },
  );

  it.each(["ship", "approve"])(
    "denies %s for an exact foreign feature even when a local feature shares its prefix",
    async (command) => {
      const { spawn } = await import("node:child_process");
      const merge = vi.spyOn(context.vcs!, "mergePullRequest");
      const root = mkdtempSync(join(tmpdir(), "gwrk-slash-exact-feature-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
      const featureId = SYNTHETIC_THREAD_ALPHA.featureId;
      const foreignFeature = join(beta.localRoot, "specs", featureId);
      const localSpecs = join(context.projectRoot, "specs");
      renameSync(
        join(localSpecs, featureId),
        join(localSpecs, `${featureId}-followup`),
      );
      mkdirSync(foreignFeature, { recursive: true });
      symlinkSync(foreignFeature, join(localSpecs, featureId), "dir");

      const response = await handleSlashCommand(
        `${command} ${featureId} 1`,
        context,
      );

      expect.soft(response.response_type).toBe("ephemeral");
      expect
        .soft(JSON.stringify(response.blocks))
        .toContain("Feature is unavailable inside this project's checkout.");
      expect.soft(spawn).not.toHaveBeenCalled();
      expect.soft(findOpenPr).not.toHaveBeenCalled();
      expect(merge).not.toHaveBeenCalled();
    },
  );

  it("resolves a ship prefix using only feature directories inside the checkout", async () => {
    const { spawn } = await import("node:child_process");
    const root = mkdtempSync(join(tmpdir(), "gwrk-slash-prefix-scope-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const foreignFeature = join(beta.localRoot, "specs", "003-beta-private");
    mkdirSync(foreignFeature, { recursive: true });
    symlinkSync(
      foreignFeature,
      join(context.projectRoot, "specs", "003-beta-private"),
      "dir",
    );

    const response = await handleSlashCommand("ship 003 1", context);

    expect.soft(response.response_type).toBe("in_channel");
    expect.soft(response.thread_ts).toBe(SYNTHETIC_THREAD_ALPHA.rootTs);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      "gwrk",
      ["ship", "003-slack", "1"],
      expect.objectContaining({ cwd: context.projectRoot }),
    );
  });

  it("only reads a decision index inside the authorized checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-slash-linked-decisions-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const relativeIndex = ".gwrk/decisions/index.md";
    const localIndex = join(context.projectRoot, relativeIndex);
    const foreignIndex = join(beta.localRoot, relativeIndex);
    for (const checkout of [context.projectRoot, beta.localRoot]) {
      mkdirSync(join(checkout, ".gwrk/decisions"), { recursive: true });
    }
    writeFileSync(localIndex, "Alpha decision index");
    writeFileSync(foreignIndex, "Beta private decision index");
    const viewerContext = { ...context, userId: SYNTHETIC_USER_VIEWER };
    const local = await handleSlashCommand("adr list", viewerContext);
    expect(JSON.stringify(local.blocks)).toContain("Alpha decision index");

    rmSync(localIndex);
    symlinkSync(foreignIndex, localIndex);
    const linked = await handleSlashCommand("adr list", viewerContext);

    expect(linked.response_type).toBe("ephemeral");
    expect(JSON.stringify(linked.blocks)).not.toContain(
      "Beta private decision index",
    );
  });

  it("decides a local ADR and verifies its generated index inside the authorized checkout", async () => {
    const decisions = join(context.projectRoot, "docs", "decisions");
    const adrPath = join(decisions, "ADR-010-track-the-decision.md");
    writeFileSync(
      join(context.projectRoot, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "alpha" } }),
    );
    mkdirSync(decisions, { recursive: true });
    writeFileSync(adrPath, proposedAdr);

    const response = await handleSlashCommand("adr decide ADR-010", context);

    expect(response.response_type).toBe("in_channel");
    expect(readFileSync(adrPath, "utf-8")).toContain("**Status:** Decided");
    expect(
      readFileSync(
        join(context.projectRoot, ".gwrk/decisions/index.md"),
        "utf-8",
      ),
    ).toContain("| ADR-010 | Slack | Decided |");
    const check = await handleSlashCommand("adr check", {
      ...context,
      userId: SYNTHETIC_USER_VIEWER,
    });
    expect(check.response_type).toBe("ephemeral");
    expect(check.blocks[0].text.text).toContain(
      "All ADR citations and decision index verified.",
    );
  });

  it.each([
    "linked corpus",
    "configured foreign corpus",
    "linked index",
    "linked index directory",
    "dangling index",
  ])(
    "rejects an ADR decision with a %s before either write",
    async (boundary) => {
      const root = mkdtempSync(join(tmpdir(), "gwrk-slash-adr-boundary-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
      const alpha = context.projectRoot;
      const localDecisions = join(alpha, "docs", "decisions");
      const foreignDecisions = join(beta.localRoot, "docs", "decisions");
      const localIndexDir = join(alpha, ".gwrk", "decisions");
      const foreignIndexDir = join(beta.localRoot, ".gwrk", "decisions");
      const localIndex = join(localIndexDir, "index.md");
      const foreignIndex = join(foreignIndexDir, "index.md");
      const adrName = "ADR-010-track-the-decision.md";
      const foreignAdr = join(foreignDecisions, adrName);
      const localAdr = join(localDecisions, adrName);

      mkdirSync(foreignDecisions, { recursive: true });
      mkdirSync(foreignIndexDir, { recursive: true });
      writeFileSync(foreignAdr, proposedAdr);
      const project = {
        name: "alpha",
        architecture:
          boundary === "configured foreign corpus"
            ? { decisions: relative(alpha, foreignDecisions) }
            : undefined,
      };
      writeFileSync(join(alpha, ".gwrkrc.json"), JSON.stringify({ project }));
      if (boundary === "linked corpus") {
        mkdirSync(join(alpha, "docs"));
        symlinkSync(foreignDecisions, localDecisions, "dir");
      } else {
        mkdirSync(localDecisions, { recursive: true });
        writeFileSync(localAdr, proposedAdr);
      }
      if (boundary === "linked index directory") {
        mkdirSync(join(alpha, ".gwrk"));
        symlinkSync(foreignIndexDir, localIndexDir, "dir");
      } else if (boundary === "linked index" || boundary === "dangling index") {
        mkdirSync(localIndexDir, { recursive: true });
        if (boundary === "linked index")
          writeFileSync(foreignIndex, "Beta index");
        symlinkSync(foreignIndex, localIndex);
      }

      const response = await handleSlashCommand("adr decide ADR-010", context);

      expect.soft(response.response_type).toBe("ephemeral");
      expect.soft(response.blocks[0].text.text).toContain("verified checkout");
      expect.soft(readFileSync(localAdr, "utf-8")).toBe(proposedAdr);
      expect.soft(readFileSync(foreignAdr, "utf-8")).toBe(proposedAdr);
      if (boundary === "linked index") {
        expect(readFileSync(foreignIndex, "utf-8")).toBe("Beta index");
      } else {
        expect.soft(existsSync(localIndex)).toBe(false);
        expect(existsSync(foreignIndex)).toBe(false);
      }
    },
  );

  it("excludes foreign citation findings when checking ADRs", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-slash-adr-check-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const foreignSrc = join(beta.localRoot, "src");
    mkdirSync(foreignSrc);
    const foreignAdrId = ["ADR", "777"].join("-");
    writeFileSync(join(foreignSrc, "beta-only.ts"), `// See ${foreignAdrId}\n`);
    const decisions = join(context.projectRoot, "docs", "decisions");
    writeFileSync(
      join(context.projectRoot, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "alpha" } }),
    );
    mkdirSync(decisions, { recursive: true });
    writeFileSync(
      join(decisions, "ADR-010-track-the-decision.md"),
      proposedAdr,
    );
    const decide = await handleSlashCommand("adr decide ADR-010", context);
    expect(decide.response_type).toBe("in_channel");
    symlinkSync(foreignSrc, join(context.projectRoot, "src"), "dir");

    const response = await handleSlashCommand("adr check", {
      ...context,
      userId: SYNTHETIC_USER_VIEWER,
    });

    expect.soft(response.response_type).toBe("ephemeral");
    expect.soft(response.blocks[0].text.text).not.toContain("beta-only.ts");
    expect(response.blocks[0].text.text).not.toContain(foreignAdrId);
  });

  it("denies ADR recording before launch when the corpus is outside the checkout", async () => {
    const { spawn } = await import("node:child_process");
    const root = mkdtempSync(join(tmpdir(), "gwrk-slash-adr-record-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
    const foreignDecisions = join(beta.localRoot, "docs", "decisions");
    const docs = join(context.projectRoot, "docs");
    writeFileSync(
      join(context.projectRoot, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "alpha" } }),
    );
    mkdirSync(foreignDecisions, { recursive: true });
    mkdirSync(docs);
    symlinkSync(foreignDecisions, join(docs, "decisions"), "dir");

    const response = await handleSlashCommand(
      "adr record Track the decision",
      context,
    );

    expect.soft(response.response_type).toBe("ephemeral");
    expect.soft(response.blocks[0].text.text).toMatch(/checkout/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["spawn", "error"] as const)(
    "reports ADR authoring launch outcome after the child emits %s",
    async (event) => {
      const { spawn } = await import("node:child_process");
      writeFileSync(
        join(context.projectRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: "alpha" } }),
      );
      const child = new ChildProcess();
      child.on("error", vi.fn());
      const unref = vi.spyOn(child, "unref");
      const error = new Error("Could not start the ADR authoring process");
      vi.mocked(spawn).mockReturnValueOnce(child);

      const settled = vi.fn();
      const pending = handleSlashCommand("adr record Track the decision", {
        ...context,
        userId: SYNTHETIC_USER_OPERATOR,
      }).then((response) => {
        settled();
        return response;
      });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      expect.soft(settled).not.toHaveBeenCalled();
      expect.soft(unref).not.toHaveBeenCalled();

      if (event === "error") child.emit("error", error);
      else child.emit("spawn");
      const response = await pending;

      expect(spawn).toHaveBeenCalledExactlyOnceWith(
        "gwrk",
        ["define", "adr", "Track the decision", "--run"],
        expect.objectContaining({
          cwd: context.projectRoot,
          env: expect.objectContaining({
            GWRK_ADR_CHECKOUT_ROOT: context.projectRoot,
            PATH: process.env.PATH,
          }),
        }),
      );
      if (event === "error") {
        expect.soft(response.response_type).toBe("ephemeral");
        expect.soft(response.blocks[0].text.text).toContain(error.message);
        expect(unref).not.toHaveBeenCalled();
      } else {
        expect.soft(response.response_type).toBe("in_channel");
        expect
          .soft(response.blocks[0].text.text)
          .toContain("Track the decision");
        expect(unref).toHaveBeenCalledOnce();
      }
    },
  );

  it("handles approve command — merges PR via VCS port", async () => {
    const merge = vi.spyOn(context.vcs!, "mergePullRequest");
    const response = await handleSlashCommand(
      "approve 003-slack phase-01",
      context,
    );
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("PR #42");
    expect((context.vcs as any).mergedPrs).toHaveLength(1);
    expect((context.vcs as any).mergedPrs[0].prNumber).toBe(42);
    expect(merge).toHaveBeenCalledWith(
      context.projectRoot,
      42,
      "github.com/org/alpha",
    );
  });

  it("handles ship command — spawns background process", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("ship 003-slack 1", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("Dispatching *003-slack*");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["ship", "003-slack", "1"],
      expect.objectContaining({
        cwd: context.projectRoot,
        detached: true,
      }),
    );
  });

  it("handles define command — spawns background process (FR-015)", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("define 003-slack", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("define spec");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["define", "spec", "003-slack"],
      expect.objectContaining({
        cwd: context.projectRoot,
        detached: true,
      }),
    );
  });

  it("handles define subcommand (plan) — spawns background process (FR-015)", async () => {
    const { spawn } = await import("node:child_process");
    const response = await handleSlashCommand("define 003-slack plan", context);
    expect(response.response_type).toBe("in_channel");
    expect(response.blocks[0].text.text).toContain("define plan");
    expect(spawn).toHaveBeenCalledWith(
      "gwrk",
      ["define", "plan", "003-slack"],
      expect.objectContaining({
        cwd: context.projectRoot,
        detached: true,
      }),
    );
  });

  it("handles define with invalid subcommand — returns usage", async () => {
    const response = await handleSlashCommand(
      "define 003-slack unknown",
      context,
    );
    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks[0].text.text).toContain("Invalid define subcommand");
  });

  it("handles pause command without args", async () => {
    const response = await handleSlashCommand("pause", context);
    expect(mockQueue.pause).toHaveBeenCalled();
    expect(response.blocks[0].text.text).toContain("Dispatch queue paused");
  });

  it("reports Pulse repositories and spec totals only for the authorized checkout", async () => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-slash-pulse-"));
    vi.stubEnv("GWRK_HOME", join(root, "home"));
    onTestFinished(() => {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    });
    const alpha = initCheckout(
      SYNTHETIC_PROJECT_ALPHA,
      join(root, "alpha-pulse"),
    );
    const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta-pulse"));
    for (const [project, features] of [
      [alpha, ["001-alpha", "002-alpha"]],
      [beta, ["001-beta", "002-beta", "003-beta"]],
    ] as const) {
      for (const feature of features) {
        const specDir = join(project.localRoot, "specs", feature);
        mkdirSync(specDir, { recursive: true });
        writeFileSync(join(specDir, "spec.md"), "# Spec\n");
      }
      const gitOptions = {
        cwd: project.localRoot,
        stdio: "ignore" as const,
        timeout: 5_000,
      };
      execFileSync(
        "git",
        [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/main",
        ],
        gitOptions,
      );
    }
    writeFileSync(join(alpha.localRoot, "specs/001-alpha/plan.md"), "# Plan\n");
    mkdirSync(join(alpha.localRoot, "specs/004-foreign"));
    symlinkSync(
      join(beta.localRoot, "specs/001-beta/spec.md"),
      join(alpha.localRoot, "specs/004-foreign/spec.md"),
    );
    const alphaAlias = join(root, "alpha-alias");
    symlinkSync(alpha.localRoot, alphaAlias, "dir");
    writeFileSync(
      join(alpha.localRoot, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: alpha.name },
        pulse: { repos: [alphaAlias, beta.localRoot] },
      }),
    );

    const response = await handleSlashCommand("pulse --project alpha", {
      ...context,
      userId: SYNTHETIC_USER_VIEWER,
      projectRoot: beta.localRoot,
      routingService: createProjectRoutingService({
        registry: registryFor(alpha, beta),
      }),
    });

    const blocks = JSON.stringify(response.blocks);
    expect.soft(blocks).toContain("*alpha-pulse*:");
    expect.soft(blocks).not.toContain("beta-pulse");
    expect(blocks).toContain("1/2 plans ready");
  });

  it("returns help for empty command", async () => {
    const response = await handleSlashCommand("", context);
    expect(response.blocks[0].text.text).toContain("gwrk");
    const helpText = response.blocks[1].text.text;
    expect(helpText).toContain("ship");
    expect(helpText).toContain("define");
  });

  it("returns error for unknown command", async () => {
    const response = await handleSlashCommand("unknown", context);
    expect(response.blocks[0].text.text).toContain(
      "Unknown command: `unknown`",
    );
  });
});

describe("checkout-scoped Slack log reads", () => {
  it.each(["feature", "runs", "file"])(
    "rejects an external %s symlink",
    (boundary) => {
      const root = mkdtempSync(join(tmpdir(), "gwrk-slack-log-scope-"));
      try {
        const alpha = join(root, "alpha");
        const beta = join(root, "beta");
        const external = join(beta, "foreign.json");
        mkdirSync(beta, { recursive: true });
        writeFileSync(
          external,
          JSON.stringify({
            feature_id: "foreign-private-metadata",
            exit_code: 0,
          }),
        );
        mkdirSync(join(alpha, "specs"), { recursive: true });
        const feature = join(alpha, "specs", "001-scoped");
        if (boundary === "feature") {
          mkdirSync(join(beta, ".gwrk", "runs"), { recursive: true });
          writeFileSync(
            join(beta, ".gwrk", "runs", "foreign.json"),
            JSON.stringify({
              feature_id: "foreign-private-metadata",
              exit_code: 0,
            }),
          );
          symlinkSync(beta, feature);
        } else {
          mkdirSync(join(feature, ".gwrk"), { recursive: true });
          if (boundary === "runs")
            symlinkSync(beta, join(feature, ".gwrk", "runs"));
          else {
            mkdirSync(join(feature, ".gwrk", "runs"));
            symlinkSync(
              external,
              join(feature, ".gwrk", "runs", "foreign.json"),
            );
          }
        }
        expect(
          JSON.stringify(buildSlackLogResponse(["001-scoped"], alpha)),
        ).not.toContain("foreign-private-metadata");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
