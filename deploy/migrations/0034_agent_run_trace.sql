ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS trace JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS agent_runs_trace_gin_idx
    ON agent_runs USING GIN (trace);
