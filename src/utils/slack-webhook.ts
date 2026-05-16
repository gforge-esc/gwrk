import * as https from "node:https";

/**
 * Sends a message via Slack Incoming Webhook (Phase 3).
 * Extracted for use in ship loop without build server.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  payload: any,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
    };

    const req = https.request(webhookUrl, options, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Slack webhook failed with status ${res.statusCode}`));
      }
    });

    req.on("error", (e) => {
      reject(e);
    });

    req.write(data);
    req.end();
  });
}
