-- Expand-only rollback: production application rollback must retain roster
-- rows and member-based winner data. Disposable migration tests execute this
-- no-op Down and then prove that Up can be applied again idempotently.
SELECT 1;
