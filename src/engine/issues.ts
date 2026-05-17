import type { IssueRecord } from "../db/issues.js";

export function associateIssueWithFeature(_issue: {
  title: string;
  labels: string[];
}): string | undefined {
  throw new Error("Not implemented");
}

export async function notifyIssueOpened(_issue: IssueRecord): Promise<void> {
  throw new Error("Not implemented");
}
