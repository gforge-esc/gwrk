# Hosted pilot live acceptance record

Live acceptance verifies production authentication and gateway controls on the live host. Blocked: pending operator live execution.

## Execution authority

- Operator: David Gonzalez
- Host: gwrk.gforge.ai
- Mode: restricted operator-only ingress
- Record status: Pending

## Acceptance observations

| Probe area | Target requirement | Status | Verdict |
|---|---|---|---|
| Google login | Allowed Google account receives session | Pending | Unperformed |
| Google denial | Unlisted Google account receives HTTP 403 | Pending | Unperformed |
| API key lifecycle | Valid API key operates scoped project | Pending | Unperformed |
| Cross-project denial | Project A key cannot access Project B | Pending | Unperformed |
| Private origin | Direct origin port remains unreachable | Pending | Unperformed |
| Header forgery | Forged proxy headers cause zero access | Pending | Unperformed |
| CSRF | Cross-origin mutation fails with HTTP 403 | Pending | Unperformed |
| Logout replay | Revoked session digest blocks replay | Pending | Unperformed |
| Webhook HMAC | Invalid webhook signature creates zero rows | Pending | Unperformed |
| Restart | Service restart retains operation receipts | Pending | Unperformed |
| Reboot | System reboot preserves auth ledger | Pending | Unperformed |
| Restore | Clean restore retains audit verifiers | Pending | Unperformed |
| Zero leaked tokens | Logs and responses contain zero tokens | Pending | Unperformed |

## Operator sign-off

Pending live execution by the authorized operator.
