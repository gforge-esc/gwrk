/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  GitHubHarvestPort,
  HarvestPullRequestFact,
} from "../../ports/operations-port.js";
import { repositoryGitEnv } from "../git/process-env.js";

const DEFAULT_GH_TIMEOUT_MS = 12_000;
const DEFAULT_GH_KILL_GRACE_MS = 500;
const DEFAULT_GH_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

type ExecuteGh = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<string>;
const sha = z
  .string()
  .regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/)
  .nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const pullRequest = z.object({
  number: z.number().int().positive().safe(),
  html_url: z.string().url(),
  state: z.enum(["open", "closed"]),
  merged_at: timestamp,
  closed_at: timestamp,
  merge_commit_sha: sha,
  base: z.object({
    ref: z.string().min(1),
    repo: z.object({ full_name: z.string().min(1) }),
  }),
  head: z.object({
    ref: z.string().min(1),
    sha,
    repo: z.object({ full_name: z.string().min(1) }).nullable(),
  }),
});

function repositoryPath(repoSlug: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoSlug))
    throw new Error("Invalid repository slug");
  return `repos/${repoSlug}`;
}

function fact(value: unknown, repoSlug: string): HarvestPullRequestFact {
  const pr = pullRequest.parse(value);
  if (pr.base.repo.full_name.toLowerCase() !== repoSlug.toLowerCase())
    throw new Error(
      "Pull request repository does not match the requested project",
    );
  const expectedUrl = `https://github.com/${repoSlug}/pull/${pr.number}`;
  if (pr.html_url.toLowerCase() !== expectedUrl.toLowerCase())
    throw new Error("Pull request URL does not match its repository identity");
  const merged = pr.merged_at !== null;
  if (merged && (pr.state !== "closed" || !pr.merge_commit_sha))
    throw new Error("Merged pull request is missing verified merge metadata");
  return {
    repoSlug,
    headRepoSlug: pr.head.repo?.full_name ?? null,
    prNumber: pr.number,
    prUrl: pr.html_url,
    state: merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN",
    merged,
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    mergeCommitSha: pr.merge_commit_sha,
    mergedAt: pr.merged_at,
    closedAt: pr.closed_at,
  };
}

function combineSignals(
  first?: AbortSignal,
  second?: AbortSignal,
): AbortSignal | undefined {
  if (first && second) return AbortSignal.any([first, second]);
  return first ?? second;
}

function spawnGh(
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  killGraceMs: number,
): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(new Error("GitHub CLI command aborted"));
  }
  return new Promise((resolve, reject) => {
    const processGroup = process.platform !== "win32";
    let env: NodeJS.ProcessEnv;
    try {
      const { GH_HOST: _ignoredGhHost, ...repoEnv } = repositoryGitEnv(cwd);
      env = { ...repoEnv, GH_PROMPT_DISABLED: "1" };
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn("gh", [...args], {
      cwd,
      env,
      detached: processGroup,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const sendSignal = (sig: NodeJS.Signals) => {
      if (processGroup && child.pid !== undefined) {
        try {
          process.kill(-child.pid, sig);
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
        }
      }
      try {
        child.kill(sig);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };

    let settled = false;
    let terminationReason: "aborted" | "timeout" | "maxBuffer" | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (killTimer !== null) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const terminate = (reason: "aborted" | "timeout" | "maxBuffer") => {
      if (terminationReason !== null) return;
      terminationReason = reason;
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      sendSignal("SIGTERM");
      killTimer = setTimeout(() => {
        killTimer = null;
        sendSignal("SIGKILL");
      }, killGraceMs);
      killTimer.unref?.();
    };

    const onAbort = () => terminate("aborted");

    timeoutTimer = setTimeout(() => terminate("timeout"), timeoutMs);
    timeoutTimer.unref?.();

    if (signal) {
      if (signal.aborted) {
        terminate("aborted");
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buf.length;
      if (stdoutBytes > DEFAULT_GH_MAX_BUFFER_BYTES) {
        terminate("maxBuffer");
        return;
      }
      stdoutChunks.push(buf);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buf.length;
      if (stderrBytes > DEFAULT_GH_MAX_BUFFER_BYTES) {
        terminate("maxBuffer");
        return;
      }
      stderrChunks.push(buf);
    });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    });

    child.once("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (terminationReason === "aborted") {
        reject(new Error("GitHub CLI command aborted"));
        return;
      }
      if (terminationReason === "timeout") {
        reject(new Error(`Command timed out: gh ${args.join(" ")}`));
        return;
      }
      if (terminationReason === "maxBuffer") {
        reject(new Error(`Command exceeded maxBuffer: gh ${args.join(" ")}`));
        return;
      }
      if (code !== 0 || exitSignal !== null) {
        const detail = stderr.trim();
        reject(
          new Error(
            `Command failed: gh ${args.join(" ")}${detail ? `\n${detail}` : ""}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

export function createGitHubHarvestAdapter(
  options: {
    executeGh?: ExecuteGh;
    signal?: AbortSignal;
    timeoutMs?: number;
    killGraceMs?: number;
  } = {},
): GitHubHarvestPort {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GH_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_GH_KILL_GRACE_MS;
  const executeGh: ExecuteGh =
    options.executeGh ??
    ((args, cwd, callSignal) =>
      spawnGh(
        args,
        cwd,
        combineSignals(options.signal, callSignal),
        timeoutMs,
        killGraceMs,
      ));
  const get = async (
    path: string,
    cwd: string,
    callSignal?: AbortSignal,
  ): Promise<unknown> => {
    const effectiveSignal = combineSignals(options.signal, callSignal);
    if (effectiveSignal?.aborted) {
      throw new Error("GitHub CLI command aborted");
    }
    return JSON.parse(
      await executeGh(
        [
          "api",
          "--hostname",
          "github.com",
          "--method",
          "GET",
          "-H",
          "Accept: application/vnd.github+json",
          path,
        ],
        cwd,
        effectiveSignal,
      ),
    );
  };
  return {
    verifyWebhookSignature(rawBody, signatureHeader, secret) {
      if (
        !secret ||
        !signatureHeader ||
        !/^sha256=[a-fA-F0-9]{64}$/.test(signatureHeader)
      )
        return false;
      const received = Buffer.from(signatureHeader.slice(7), "hex");
      const expected = createHmac("sha256", secret).update(rawBody).digest();
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    },
    async listTerminalPullRequests({
      cwd,
      repoSlug,
      baseBranch,
      sinceIso,
      signal,
    }) {
      const repository = repositoryPath(repoSlug);
      const cutoff = sinceIso == null ? undefined : Date.parse(sinceIso);
      if (cutoff !== undefined && !Number.isFinite(cutoff))
        throw new Error("Invalid harvest cursor timestamp");
      const pageFacts = async (page: number) => {
        const query = new URLSearchParams({
          state: "all",
          sort: "created",
          direction: "asc",
          per_page: "100",
          page: String(page),
        });
        const response = await get(`${repository}/pulls?${query}`, cwd, signal);
        if (!Array.isArray(response) || response.length > 100)
          throw new Error(
            "Pull request page must be an array of at most 100 records",
          );
        return response.map((value) => fact(value, repoSlug));
      };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const identities: number[][] = [];
        const seen = new Set<number>();
        let complete = false;
        let changed = false;
        for (let page = 1; page <= 1000; page += 1) {
          const facts = await pageFacts(page);
          const numbers = facts.map(({ prNumber }) => prNumber);
          if (
            numbers.some((number) => seen.has(number)) ||
            new Set(numbers).size !== numbers.length
          ) {
            changed = true;
            break;
          }
          for (const number of numbers) seen.add(number);
          identities.push(numbers);
          if (facts.length < 100) {
            complete = true;
            break;
          }
        }
        if (changed) continue;
        if (!complete)
          throw new Error(
            "Pull request pagination exceeded the bounded page limit",
          );
        const collected = new Map<number, HarvestPullRequestFact>();
        for (let index = 0; index < identities.length; index += 1) {
          const facts = await pageFacts(index + 1);
          const expected = identities[index];
          if (
            facts.length !== expected.length ||
            facts.some((pr, i) => pr.prNumber !== expected[i])
          ) {
            changed = true;
            break;
          }
          for (const pr of facts) {
            if (pr.state === "OPEN" || pr.baseBranch !== baseBranch) continue;
            const terminalAt = pr.mergedAt ?? pr.closedAt;
            if (!terminalAt)
              throw new Error(
                "Terminal pull request is missing its completion timestamp",
              );
            if (cutoff === undefined || Date.parse(terminalAt) >= cutoff)
              collected.set(pr.prNumber, pr);
          }
        }
        if (!changed) return [...collected.values()];
      }
      throw new Error(
        "Pull request scan could not establish completeness due to concurrent updates",
      );
    },
    async listOpenPullRequests({
      cwd,
      repoSlug,
      baseBranch,
      headBranch,
      signal,
    }) {
      const repository = repositoryPath(repoSlug);
      const owner = repoSlug.split("/")[0];
      const collected = new Map<number, HarvestPullRequestFact>();
      for (let page = 1; page <= 1000; page += 1) {
        const query = new URLSearchParams({
          state: "open",
          base: baseBranch,
          per_page: "100",
          page: String(page),
        });
        if (headBranch) {
          query.set("head", `${owner}:${headBranch}`);
        }
        const response = await get(`${repository}/pulls?${query}`, cwd, signal);
        if (!Array.isArray(response) || response.length > 100)
          throw new Error(
            "Pull request page must be an array of at most 100 records",
          );
        for (const value of response) {
          const pr = fact(value, repoSlug);
          if (pr.state !== "OPEN" || pr.baseBranch !== baseBranch) continue;
          if (headBranch && pr.headBranch !== headBranch) continue;
          collected.set(pr.prNumber, pr);
        }
        if (response.length < 100) {
          return [...collected.values()];
        }
      }
      throw new Error(
        "Pull request pagination exceeded the bounded page limit",
      );
    },
    async getPullRequest({ cwd, repoSlug, prNumber, signal }) {
      if (!Number.isSafeInteger(prNumber) || prNumber <= 0)
        throw new Error("Invalid pull request number");
      const result = fact(
        await get(`${repositoryPath(repoSlug)}/pulls/${prNumber}`, cwd, signal),
        repoSlug,
      );
      if (result.prNumber !== prNumber)
        throw new Error("Pull request number does not match the lookup");
      return result;
    },
  };
}
