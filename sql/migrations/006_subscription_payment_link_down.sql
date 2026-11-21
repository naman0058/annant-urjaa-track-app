-- Reversible rollback for 006 (run only when authorized).

SET @db := DATABASE();

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions'
    AND CONSTRAINT_NAME = 'fk_transactions_subscription_id'
);

SET @drop_fk := IF(
  @fk_exists > 0,
  'ALTER TABLE transactions DROP FOREIGN KEY fk_transactions_subscription_id',
  'SELECT ''FK not present'' AS note'
);
PREPARE stmt FROM @drop_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'subscription_id'
);

SET @drop_col := IF(
  @col_exists > 0,
  'ALTER TABLE transactions DROP INDEX idx_transactions_subscription_id, DROP COLUMN subscription_id',
  'SELECT ''column not present'' AS note'
);
PREPARE stmt2 FROM @drop_col;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;