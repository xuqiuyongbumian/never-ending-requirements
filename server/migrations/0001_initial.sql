CREATE TABLE IF NOT EXISTS game_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  elapsed REAL,
  properties_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_events_timestamp
  ON game_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_game_events_run_type
  ON game_events(run_id, type);
CREATE INDEX IF NOT EXISTS idx_game_events_session_type
  ON game_events(session_id, type);

CREATE TABLE IF NOT EXISTS game_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'loss')),
  completed_requests INTEGER NOT NULL CHECK (completed_requests >= 0),
  recruit_count INTEGER NOT NULL CHECK (recruit_count >= 0),
  missed_requests INTEGER NOT NULL CHECK (missed_requests >= 0),
  final_era INTEGER NOT NULL CHECK (final_era BETWEEN 0 AND 2),
  final_tech_debt REAL NOT NULL CHECK (final_tech_debt BETWEEN 0 AND 1000),
  final_project_health REAL NOT NULL CHECK (final_project_health BETWEEN 0 AND 100),
  score INTEGER NOT NULL CHECK (score >= 0),
  game_version TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_runs_score
  ON game_runs(score DESC, ended_at ASC);
CREATE INDEX IF NOT EXISTS idx_game_runs_result_ended_at
  ON game_runs(result, ended_at);
