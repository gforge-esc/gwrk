# Hosted lint enforcement

GitHub rejected an intentional formatting error after build and tests passed. The Phase 5 candidate passed both required Node jobs and both lint steps.

## Formatting probe

| Check | Required result | Observed result | Verdict |
|---|---|---|---|
| Node 22 build and tests with formatting fixture | Pass | Pass | Pass |
| Node 22 lint with formatting fixture | Fail | Exit 1 for the fixture | Pass |
| Node 20 lint after fixture removal | Pass | Pass | Pass |
| Node 22 lint after fixture removal | Pass | Pass | Pass |

The negative head was `23a7ed71`. [The failing run](https://github.com/gforge-esc/gwrk/actions/runs/44369802984) reported one formatting error in `src/ci-lint-negative-fixture.ts`. Matrix fail-fast canceled Node 20 after Node 22 failed at lint.

Commit `4484b570` removed the fixture. [The clean run](https://github.com/gforge-esc/gwrk/actions/runs/44370678999) passed both matrix jobs. [Draft pull request 237](https://github.com/gforge-esc/gwrk/pull/237) closed without merging.

The earlier ship invocation recorded a failed acceptance dispatch after Antigravity exhausted its credits. This hosted evidence supplements that record. It does not change the failed invocation into a successful ship run.

## Phase 5 candidate

GitHub Actions tested candidate `f6f7942b3734968e52c59ee69f3284c95ab8c2b8` with the lint inventory repair and the receipt gate. [GitHub Actions run 44379835252](https://github.com/gforge-esc/gwrk/actions/runs/44379835252) · [Draft pull request 238](https://github.com/gforge-esc/gwrk/pull/238)

The candidate and the pull request merge checkout shared Git tree `96e617ee886625fcd3a8b5d33775ba8b8acb8283`.

The gate rejected the `4484b570` receipt. It also rejected receipts with either matrix job missing or a skipped `Lint` step.

The earlier receipt remains in receipts/2026-11-18-phase05-f6f7942b.json.

The current receipt covers aebcf031 after preserving the earlier hosted receipt. [Run 44390879079](https://github.com/gforge-esc/gwrk/actions/runs/44390879079) passed both Node jobs and both lint steps.

The final Phase 5 gate verified this receipt and passed 1,903 tests. Build, blocking lint and the decision citation check also passed.

Output from `gh run view 44390879079 --json headSha,url,jobs`, formatted as JSON.

```json
{
  "headSha": "aebcf031bf288de6e0863b150ed160ae64af4f9e",
  "jobs": [
    {
      "completedAt": "2026-11-18T20:26:56Z",
      "conclusion": "success",
      "databaseId": 135107860745,
      "name": "ci (22)",
      "startedAt": "2026-11-18T20:25:32Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-11-18T20:25:34Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-11-18T20:25:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:35Z",
          "conclusion": "success",
          "name": "Checkout",
          "number": 2,
          "startedAt": "2026-11-18T20:25:34Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:36Z",
          "conclusion": "success",
          "name": "Setup Node.js 22",
          "number": 3,
          "startedAt": "2026-11-18T20:25:35Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:37Z",
          "conclusion": "success",
          "name": "Setup pnpm",
          "number": 4,
          "startedAt": "2026-11-18T20:25:36Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:56Z",
          "conclusion": "success",
          "name": "Install dependencies",
          "number": 5,
          "startedAt": "2026-11-18T20:25:37Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:01Z",
          "conclusion": "success",
          "name": "Build",
          "number": 6,
          "startedAt": "2026-11-18T20:25:56Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:02Z",
          "conclusion": "success",
          "name": "Check ADR citations and index",
          "number": 7,
          "startedAt": "2026-11-18T20:26:01Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:02Z",
          "conclusion": "success",
          "name": "Configure Git for tests",
          "number": 8,
          "startedAt": "2026-11-18T20:26:02Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:52Z",
          "conclusion": "success",
          "name": "Test",
          "number": 9,
          "startedAt": "2026-11-18T20:26:02Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:53Z",
          "conclusion": "success",
          "name": "Lint",
          "number": 10,
          "startedAt": "2026-11-18T20:26:52Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:53Z",
          "conclusion": "success",
          "name": "Post Setup pnpm",
          "number": 18,
          "startedAt": "2026-11-18T20:26:53Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:53Z",
          "conclusion": "success",
          "name": "Post Setup Node.js 22",
          "number": 19,
          "startedAt": "2026-11-18T20:26:53Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:53Z",
          "conclusion": "success",
          "name": "Post Checkout",
          "number": 20,
          "startedAt": "2026-11-18T20:26:53Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:53Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 21,
          "startedAt": "2026-11-18T20:26:53Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/gforge-esc/gwrk/actions/runs/44390879079/job/135107860745"
    },
    {
      "completedAt": "2026-11-18T20:27:09Z",
      "conclusion": "success",
      "databaseId": 135107861409,
      "name": "ci (20)",
      "startedAt": "2026-11-18T20:25:32Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-11-18T20:25:34Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-11-18T20:25:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:35Z",
          "conclusion": "success",
          "name": "Checkout",
          "number": 2,
          "startedAt": "2026-11-18T20:25:34Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:38Z",
          "conclusion": "success",
          "name": "Setup Node.js 20",
          "number": 3,
          "startedAt": "2026-11-18T20:25:35Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:25:39Z",
          "conclusion": "success",
          "name": "Setup pnpm",
          "number": 4,
          "startedAt": "2026-11-18T20:25:38Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:24Z",
          "conclusion": "success",
          "name": "Install dependencies",
          "number": 5,
          "startedAt": "2026-11-18T20:25:39Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:29Z",
          "conclusion": "success",
          "name": "Build",
          "number": 6,
          "startedAt": "2026-11-18T20:26:24Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:29Z",
          "conclusion": "success",
          "name": "Check ADR citations and index",
          "number": 7,
          "startedAt": "2026-11-18T20:26:29Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:26:29Z",
          "conclusion": "success",
          "name": "Configure Git for tests",
          "number": 8,
          "startedAt": "2026-11-18T20:26:29Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:05Z",
          "conclusion": "success",
          "name": "Test",
          "number": 9,
          "startedAt": "2026-11-18T20:26:29Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:05Z",
          "conclusion": "success",
          "name": "Lint",
          "number": 10,
          "startedAt": "2026-11-18T20:27:05Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:05Z",
          "conclusion": "success",
          "name": "Post Setup pnpm",
          "number": 18,
          "startedAt": "2026-11-18T20:27:05Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:05Z",
          "conclusion": "success",
          "name": "Post Setup Node.js 20",
          "number": 19,
          "startedAt": "2026-11-18T20:27:05Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:06Z",
          "conclusion": "success",
          "name": "Post Checkout",
          "number": 20,
          "startedAt": "2026-11-18T20:27:05Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T20:27:06Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 21,
          "startedAt": "2026-11-18T20:27:06Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/gforge-esc/gwrk/actions/runs/44390879079/job/135107861409"
    }
  ],
  "url": "https://github.com/gforge-esc/gwrk/actions/runs/44390879079"
}
```
