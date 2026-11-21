-- Blog CMS normalized schema (non-destructive: CREATE only + safe adds)
-- Apply via: npm run migrate:blog
-- Post ALTER/column renames: scripts/migrate-blog-alter.js (idempotent)

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  description TEXT NULL,
  meta_title VARCHAR(70) NULL,
  meta_description VARCHAR(320) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_cat_slug (slug),
  INDEX idx_blog_cat_sort (sort_order, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tags (many-to-many via blog_post_tags)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_tag_slug (slug),
  UNIQUE KEY uq_blog_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id INT NOT NULL,
  tag_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, tag_id),
  INDEX idx_bpt_tag (tag_id),
  CONSTRAINT fk_bpt_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_bpt_tag FOREIGN KEY (tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- File/directory import jobs (distinct from legacy blog_import_batches CSV flow)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_import_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_key VARCHAR(64) NOT NULL,
  job_type ENUM('directory_scan','single_file','bulk_rewrite','bulk_seo') NOT NULL DEFAULT 'directory_scan',
  source_directory VARCHAR(500) NULL,
  total_files INT UNSIGNED NOT NULL DEFAULT 0,
  pending_count INT UNSIGNED NOT NULL DEFAULT 0,
  processing_count INT UNSIGNED NOT NULL DEFAULT 0,
  completed_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('pending','queued','processing','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  ai_model VARCHAR(80) NULL,
  config_json JSON NULL,
  estimated_tokens INT UNSIGNED NULL,
  actual_tokens INT UNSIGNED NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_by_admin_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_import_job_key (job_key),
  INDEX idx_bij_status (status),
  INDEX idx_bij_created (created_at),
  CONSTRAINT fk_bij_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_import_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  file_hash CHAR(64) NULL,
  status ENUM('pending','processing','completed','failed','skipped') NOT NULL DEFAULT 'pending',
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  post_id INT NULL,
  ai_request_id VARCHAR(80) NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bii_job_file (job_id, file_name),
  UNIQUE KEY uq_bii_job_hash (job_id, file_hash),
  INDEX idx_bii_status (status),
  INDEX idx_bii_post (post_id),
  CONSTRAINT fk_bii_job FOREIGN KEY (job_id) REFERENCES blog_import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_bii_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Revisions (version history — JSON snapshot avoids duplicating normalized post row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  change_summary VARCHAR(255) NULL,
  created_by_admin_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_rev (post_id, revision_number),
  INDEX idx_blog_rev_post (post_id, created_at),
  CONSTRAINT fk_blog_rev_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_blog_rev_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Slug redirects (301 after publish URL change)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_redirects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  old_slug VARCHAR(280) NOT NULL,
  is_permanent TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_redirect_slug (old_slug),
  INDEX idx_blog_redirect_post (post_id),
  CONSTRAINT fk_blog_redir_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Audit (no secrets — action metadata only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blog_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  metadata_json JSON NULL,
  ip_hash CHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_blog_audit_admin (admin_id, created_at),
  INDEX idx_blog_audit_entity (entity_type, entity_id),
  INDEX idx_blog_audit_action (action, created_at),
  CONSTRAINT fk_blog_audit_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;