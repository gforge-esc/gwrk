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

Output from `gh run view 44379835252 --json headSha,url,jobs`, formatted as JSON.

```json
{
  "headSha": "f6f7942b3734968e52c59ee69f3284c95ab8c2b8",
  "jobs": [
    {
      "completedAt": "2026-11-18T19:24:25Z",
      "conclusion": "success",
      "databaseId": 135068727104,
      "name": "ci (22)",
      "startedAt": "2026-11-18T19:22:31Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-11-18T19:22:33Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-11-18T19:22:32Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:34Z",
          "conclusion": "success",
          "name": "Checkout",
          "number": 2,
          "startedAt": "2026-11-18T19:22:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:38Z",
          "conclusion": "success",
          "name": "Setup Node.js 22",
          "number": 3,
          "startedAt": "2026-11-18T19:22:34Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:40Z",
          "conclusion": "success",
          "name": "Setup pnpm",
          "number": 4,
          "startedAt": "2026-11-18T19:22:38Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:07Z",
          "conclusion": "success",
          "name": "Install dependencies",
          "number": 5,
          "startedAt": "2026-11-18T19:22:40Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:14Z",
          "conclusion": "success",
          "name": "Build",
          "number": 6,
          "startedAt": "2026-11-18T19:23:07Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:15Z",
          "conclusion": "success",
          "name": "Check ADR citations and index",
          "number": 7,
          "startedAt": "2026-11-18T19:23:14Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:15Z",
          "conclusion": "success",
          "name": "Configure Git for tests",
          "number": 8,
          "startedAt": "2026-11-18T19:23:15Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:20Z",
          "conclusion": "success",
          "name": "Test",
          "number": 9,
          "startedAt": "2026-11-18T19:23:15Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:21Z",
          "conclusion": "success",
          "name": "Lint",
          "number": 10,
          "startedAt": "2026-11-18T19:24:20Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:21Z",
          "conclusion": "success",
          "name": "Post Setup pnpm",
          "number": 18,
          "startedAt": "2026-11-18T19:24:21Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:21Z",
          "conclusion": "success",
          "name": "Post Setup Node.js 22",
          "number": 19,
          "startedAt": "2026-11-18T19:24:21Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:21Z",
          "conclusion": "success",
          "name": "Post Checkout",
          "number": 20,
          "startedAt": "2026-11-18T19:24:21Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:21Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 21,
          "startedAt": "2026-11-18T19:24:21Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/gforge-esc/gwrk/actions/runs/44379835252/job/135068727104"
    },
    {
      "completedAt": "2026-11-18T19:24:50Z",
      "conclusion": "success",
      "databaseId": 135068727665,
      "name": "ci (20)",
      "startedAt": "2026-11-18T19:22:30Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-11-18T19:22:33Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-11-18T19:22:31Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:37Z",
          "conclusion": "success",
          "name": "Checkout",
          "number": 2,
          "startedAt": "2026-11-18T19:22:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:43Z",
          "conclusion": "success",
          "name": "Setup Node.js 20",
          "number": 3,
          "startedAt": "2026-11-18T19:22:37Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:22:45Z",
          "conclusion": "success",
          "name": "Setup pnpm",
          "number": 4,
          "startedAt": "2026-11-18T19:22:43Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:50Z",
          "conclusion": "success",
          "name": "Install dependencies",
          "number": 5,
          "startedAt": "2026-11-18T19:22:45Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:57Z",
          "conclusion": "success",
          "name": "Build",
          "number": 6,
          "startedAt": "2026-11-18T19:23:50Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:57Z",
          "conclusion": "success",
          "name": "Check ADR citations and index",
          "number": 7,
          "startedAt": "2026-11-18T19:23:57Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:23:57Z",
          "conclusion": "success",
          "name": "Configure Git for tests",
          "number": 8,
          "startedAt": "2026-11-18T19:23:57Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:46Z",
          "conclusion": "success",
          "name": "Test",
          "number": 9,
          "startedAt": "2026-11-18T19:23:57Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:47Z",
          "conclusion": "success",
          "name": "Lint",
          "number": 10,
          "startedAt": "2026-11-18T19:24:46Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:47Z",
          "conclusion": "success",
          "name": "Post Setup pnpm",
          "number": 18,
          "startedAt": "2026-11-18T19:24:47Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:48Z",
          "conclusion": "success",
          "name": "Post Setup Node.js 20",
          "number": 19,
          "startedAt": "2026-11-18T19:24:47Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:48Z",
          "conclusion": "success",
          "name": "Post Checkout",
          "number": 20,
          "startedAt": "2026-11-18T19:24:48Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-11-18T19:24:48Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 21,
          "startedAt": "2026-11-18T19:24:48Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/gforge-esc/gwrk/actions/runs/44379835252/job/135068727665"
    }
  ],
  "url": "https://github.com/gforge-esc/gwrk/actions/runs/44379835252"
}
```
