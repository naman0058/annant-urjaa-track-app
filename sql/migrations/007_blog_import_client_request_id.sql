-- Idempotent client_request_id for import job idempotency (also applied by scripts/migrate-blog-import-alter.js)
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'blog_import_jobs'
    AND COLUMN_NAME = 'client_request_id'
);
SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE blog_import_jobs ADD COLUMN client_request_id VARCHAR(64) NULL AFTER job_key',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;