ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
