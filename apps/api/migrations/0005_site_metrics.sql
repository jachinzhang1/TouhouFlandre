-- +goose Up
CREATE TABLE site_metric (
    key        text PRIMARY KEY,
    value      bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_metric (key, value)
VALUES ('visits_total', 0);

-- +goose Down
DROP TABLE site_metric;
