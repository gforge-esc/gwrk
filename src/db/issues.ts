export interface IssueRecord {
  issue_number: number;
  feature_id: string;
  title: string;
  body: string;
  state: "open" | "closed";
  created_at: string;
  closed_at?: string;
  author: string;
}

export function saveIssue(_issue: IssueRecord, _db?: any): number {
  throw new Error("Not implemented");
}

export function updateIssue(
  _issueNumber: number,
  _updates: Partial<IssueRecord>,
  _db?: any,
): void {
  throw new Error("Not implemented");
}

export function listIssues(_featureId: string, _db?: any): IssueRecord[] {
  throw new Error("Not implemented");
}
