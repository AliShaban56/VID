CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  story TEXT NOT NULL,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS drafts_created_at_idx ON drafts(created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  story TEXT NOT NULL,
  platforms_json TEXT NOT NULL DEFAULT '[]',
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduled_posts_scheduled_at_idx ON scheduled_posts(scheduled_at);

