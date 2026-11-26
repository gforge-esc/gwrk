# Handoff readiness

The hosted service is ready for an operator-assisted project rollout. The public documentation is not yet a complete self-service handoff for a person or agent. Blocked: unattended onboarding lacks one verified end-to-end guide. Documentation ownership remains unassigned.

## Scope

Assessment date: November 25, 2026, America/Denver. Reviewed merged release bb15497bfeff881e4597972438e586ca98100b56. Checked GitHub main and develop README contents through the GitHub API. Probed public documentation URLs without credentials. This assessment did not enroll a project or execute a real project task.

## Green

| Initiative | Owner | Fact | Next move |
|---|---|---|---|
| Hosted service | David | Accepted release at https://gwrk.gforge.ai | Select first project before enrollment |

The local deployment checkpoint records actual Google login, logout revocation, scoped API access, denial cases, restart continuity and independent review. This assessment separately observed public root HTTP 200 with 409721 bytes. It did not repeat authenticated acceptance.

## Amber

| Initiative | Owner | Fact | Next move |
|---|---|---|---|
| Human onboarding | Unassigned | README still labels beta as alpha | Correct entry guide before wider handoff |
| Agent onboarding | Unassigned | No checked consumer-agent entry guide | Add a versioned agent guide before unattended use |
| First real project | David | Acceptance uses pilot projects | Enroll one chosen project before hosted execution |

No dates have been assigned to these next moves.

## Findings

1. README on main and develop matches the deployed tree. It labels gwrk alpha six times and never links gwrk.gforge.ai. Package version is 1.6.0-beta.1. Its install example assumes the reader already has the source checkout. Its ship example omits worktree isolation and iteration bounds. Source: https://github.com/gforge-esc/gwrk/blob/bb15497bfeff881e4597972438e586ca98100b56/README.md
2. Getting Started assumes .gwrkrc.local.json.example exists in the consumer project. It still lists gemini as an agent choice. The current initializer probes agy, claude and codex. The guide uses gwrk's own hosted-pilot feature as the example. Source: https://github.com/gforge-esc/gwrk/blob/bb15497bfeff881e4597972438e586ca98100b56/docs/site/getting-started.md
3. The CLI guide describes a gwrk_ak_v1_ credential prefix. Actual parsing accepts gwrk_v1.<id>.<secret>. Source: docs/site/cli-reference.md and src/domain/auth-policy.ts in the reviewed release.
4. API examples assume access to an operator key at an AWS host-local path. They do not explain how a consumer obtains a project-scoped credential. The browser session curl example assumes a cookie named __Host-gwrk_session without establishing that this is the configured proxy cookie. It should not serve as the canonical authentication recipe. Source: docs/site/api-reference.md.
5. The guides cover configuration and architecture but do not join installation, account access, server-side project enrollment, repository availability, role binding, credential provisioning, agent readiness, dispatch, harvest and notification receipts into one consumer walkthrough. Google login alone does not grant project access.
6. Gwrk's own AGENTS.md contains contributor and operator instructions. A consumer agent needs the target project's generated instructions and decisions. Copying gwrk's AGENTS.md into another repository would carry unrelated gwrk-specific rules.
7. Public probes returned /llms.txt 404, /openapi.json 404, /docs 404 and /getting-started.html 404. /api-reference.html returned 401. The portal embeds guides through hash navigation. Use its actual hash links rather than inferred standalone documentation URLs. Absence of llms.txt is not a functional blocker, but the large embedded portal is a poor sole agent reference.
8. The latest release tag predates the portal merge. Its version matches the current package. Pinning only the version does not establish that a new installation contains the hosted fixes. Verify the install artifact against the accepted commit before publishing an install recipe.

## Recommended handoff

Use both the portal and versioned repository documentation. Lead a person to the portal for orientation and Google login. Give an agent a short consumer guide and the accepted commit. The target project checkout is its working context. The gwrk source repository is reference material unless its task is to modify gwrk itself.

A project handoff must supply the project checkout, repository identity, approved task, target architecture, decisions, expected verification and merge authority. Hosted work also needs an enrolled server project, repository availability, agent readiness and a protected project-scoped credential. Supply a credential-file reference through the approved secret mechanism. Never include key contents in the prompt.

An agent should read the target project's AGENTS.md, .gwrk/architecture.md and .gwrk/decisions/index.md when present. It should report missing setup before dispatch. Initialization supplies context without proving code conformance. Preserve one writer per feature branch. Use isolated worktrees and bounded single-phase ship calls. Keep final merge approval with David unless he delegates it.

## Completion evidence needed

1. A new reader can install the accepted release from the documented starting point.
2. A reader can initialize a fresh repository and an existing repository without copying gwrk contributor files.
3. An authorized operator can connect the project to the server and grant scoped access.
4. A fresh agent can produce a dry run using only the consumer handoff.
5. One real project task completes definition, implementation, review and harvest with attributable receipts.
6. README and portal guides agree with the same versioned consumer guide.

## Verification limits

No real Wisecode project enrollment or hosted task was verified here. No conclusion is drawn about the current AWS agent quotas or credentials. Public documentation failures are HTTP observations, not browser navigation tests. Original release evidence remains under .runs/aws-hosted-pilot-nov23/PORTAL-DEPLOYMENT-CHECKPOINT.md.
