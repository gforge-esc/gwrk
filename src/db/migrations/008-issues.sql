CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number INTEGER NOT NULL,
  feature_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  html_url TEXT,
  created_at DATETIME NOT NULL,
  closed_at DATETIME,
  author TEXT NOT NULL,
  UNIQUE(issue_number)
);
