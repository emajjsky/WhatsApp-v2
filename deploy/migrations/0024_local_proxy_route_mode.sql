ALTER TABLE local_proxy_endpoints
    ADD COLUMN IF NOT EXISTS route_mode TEXT NOT NULL DEFAULT 'auto';

UPDATE local_proxy_endpoints
SET route_mode = 'auto'
WHERE route_mode IS NULL OR route_mode NOT IN ('auto', 'direct', 'system');

ALTER TABLE local_proxy_endpoints
    DROP CONSTRAINT IF EXISTS local_proxy_endpoints_route_mode_check;

ALTER TABLE local_proxy_endpoints
    ADD CONSTRAINT local_proxy_endpoints_route_mode_check
    CHECK (route_mode IN ('auto', 'direct', 'system'));
