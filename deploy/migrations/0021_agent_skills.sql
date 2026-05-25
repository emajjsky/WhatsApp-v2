CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    skill_markdown TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_slug_unique
    ON agent_skills (LOWER(slug));

CREATE INDEX IF NOT EXISTS agent_skills_enabled_idx
    ON agent_skills (enabled);

CREATE TABLE IF NOT EXISTS agent_skill_files (
    id UUID PRIMARY KEY,
    skill_id UUID NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    file_kind TEXT NOT NULL CHECK (file_kind IN ('skill', 'reference', 'asset')),
    content_type TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8',
    content_text TEXT NOT NULL DEFAULT '',
    byte_size BIGINT NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_skill_files_skill_path_unique
    ON agent_skill_files (skill_id, LOWER(path));

CREATE INDEX IF NOT EXISTS agent_skill_files_skill_kind_idx
    ON agent_skill_files (skill_id, file_kind, sort_order);

CREATE TABLE IF NOT EXISTS system_agent_skill_bindings (
    agent_id UUID NOT NULL REFERENCES system_agents(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS system_agent_skill_bindings_skill_idx
    ON system_agent_skill_bindings (skill_id);
