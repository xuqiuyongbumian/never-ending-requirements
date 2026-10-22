ALTER TABLE game_runs ADD COLUMN nickname TEXT;

CREATE INDEX IF NOT EXISTS idx_game_runs_session_ended
  ON game_runs(session_id, ended_at DESC);
