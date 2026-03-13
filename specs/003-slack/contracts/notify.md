# Contract: POST /api/notify

## Request
interface NotifyPayload {
  type: "phase_start" | "phase_complete" | "phase_fail" | "ci_result" | "review_ready" | "done_done";
  feature: string;
  phase?: string;
  backend?: string;
  branch?: string;
  error?: string;
  gateResults?: string;
  prUrl?: string;
  prNumber?: number;
  opsOnly?: boolean;
}

## Response (200)
{ "ok": true }

## Response (400)
{ "ok": false, "error": string }

## Side Effects
- Calls notifySlack(message, { opsOnly }) with Block Kit payload
- Does NOT throw if Slack unavailable (non-fatal)
