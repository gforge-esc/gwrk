# Contract: GitHub Webhook

**Path**: `specs/011-harvest/contracts/webhook.md`
**Type**: API Contract

This contract defines the build server's GitHub webhook handler for `pull_request` events.

## Endpoint: `POST /webhook/github`

### Request Headers
- `X-GitHub-Event`: `pull_request` (required)
- `X-Hub-Signature-256`: HMAC-SHA256 signature (required for production)

### Request Payload (Subset)
```json
{
  "action": "closed",
  "pull_request": {
    "number": 42,
    "merged": true,
    "merged_at": "2026-04-01T09:15:00Z",
    "merge_commit_sha": "abc1234567890",
    "head": {
      "ref": "feat/004-ship-loop-p1"
    },
    "base": {
      "ref": "develop"
    }
  }
}
```

### Handler Behavior
1. **Signature Verification**: Validate `X-Hub-Signature-256` using `process.env.GITHUB_WEBHOOK_SECRET`. Fail with 401 if invalid.
2. **Filter Actions**: Ignore if `action` is not `closed` or `merged` is `false`.
3. **Filter Branches**: Ignore if `base.ref` is not `develop` or `main`.
4. **Parse Feature**: Extract `<featureId>` from `head.ref` (e.g., `feat/011-harvest` -> `011-harvest`).
5. **Trigger Harvest**: Call `engine.harvestFeature()` with extracted payload.

### Response
- `200 OK`: Webhook accepted and processed (or ignored by filter).
- `401 Unauthorized`: Invalid signature.
- `400 Bad Request`: Missing headers or malformed payload.
