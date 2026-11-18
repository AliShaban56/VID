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


CREATE TABLE IF NOT EXISTS kie_api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kie_api_keys_created_at_idx ON kie_api_keys(created_at);

CREATE TABLE IF NOT EXISTS social_platform_preferences (
  platform TEXT PRIMARY KEY,
  auto_publish INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_oauth_states (state TEXT PRIMARY KEY, platform TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS social_accounts (platform TEXT PRIMARY KEY, account_id TEXT, account_name TEXT, encrypted_tokens TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '', connected_at TEXT NOT NULL, updated_at TEXT NOT NULL);
