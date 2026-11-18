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

-- Remove legacy account-linking and cloud-browser integration storage.
DROP TABLE IF EXISTS social_accounts;
DROP TABLE IF EXISTS social_oauth_states;
DROP TABLE IF EXISTS social_platform_preferences;
DROP TABLE IF EXISTS browserbase_contexts;


CREATE TABLE IF NOT EXISTS kie_key_rotation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agnes_api_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);
