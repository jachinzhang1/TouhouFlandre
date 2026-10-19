-- Expand-only rollback: production keeps the new tables and columns so the
-- previous binary can continue reading legacy race/relay storage. Disposable
-- migration tests may move the goose version back and reapply this migration.
SELECT 1;
