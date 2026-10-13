-- Expand-only rollback: the previous binary ignores chat state, while retaining
-- messages keeps a rollback from silently destroying user history.
SELECT 1;
