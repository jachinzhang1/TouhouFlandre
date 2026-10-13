-- Expand-only rollback: keep the widened terminal state vocabulary so a
-- rollback does not strand already-written lifecycle rows.
SELECT 1;
