-- Phase 4B: optional link from transactions -> subscriptions (forward-looking).
-- Safe: nullable column, no backfill, preserves all existing rows.
-- Rollback: run 006_subscription_payment_link_down.sql

SET @db := DATABASE();

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'subscription_id'
);

SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE transactions
     ADD COLUMN subscription_id INT NULL COMMENT ''Set when payment capture creates or extends a subscription'',
     ADD INDEX idx_transactions_subscription_id (subscription_id)',
  'SELECT ''subscription_id already exists'' AS note'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions'
    AND CONSTRAINT_NAME = 'fk_transactions_subscription_id'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @fk_ddl := IF(
  @fk_exists = 0 AND @col_exists = 0,
  'ALTER TABLE transactions
     ADD CONSTRAINT fk_transactions_subscription_id
     FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
     ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''FK skipped or already present'' AS note'
);
PREPARE fkstmt FROM @fk_ddl;
EXECUTE fkstmt;
DEALLOCATE PREPARE fkstmt;