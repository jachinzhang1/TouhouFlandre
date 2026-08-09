-- 站点级计数器
-- name: IncrementSiteVisitCount :one
INSERT INTO site_metric (key, value)
VALUES ('visits_total', 1)
ON CONFLICT (key) DO UPDATE
SET
    value = site_metric.value + 1,
    updated_at = now()
RETURNING value;
