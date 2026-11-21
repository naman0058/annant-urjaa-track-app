-- Blog CMS (non-destructive migration)
-- Apply with: npm run migrate:blog

CREATE TABLE IF NOT EXISTS blog_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(280) NOT NULL,
  excerpt TEXT NULL,
  content_html MEDIUMTEXT NULL,
  content_text MEDIUMTEXT NULL,
  status ENUM('draft','review','scheduled','published','archived') NOT NULL DEFAULT 'draft',
  featured_image VARCHAR(500) NULL,
  meta_title VARCHAR(70) NULL,
  meta_description VARCHAR(320) NULL,
  meta_keywords VARCHAR(500) NULL,
  canonical_url VARCHAR(500) NULL,
  og_title VARCHAR(100) NULL,
  og_description VARCHAR(320) NULL,
  robots VARCHAR(80) NOT NULL DEFAULT 'index,follow',
  source_url VARCHAR(500) NULL,
  source_content_hash CHAR(64) NULL,
  author_admin_id INT NULL,
  ai_rewritten TINYINT(1) NOT NULL DEFAULT 0,
  ai_model VARCHAR(80) NULL,
  published_at DATETIME NULL,
  scheduled_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_slug (slug),
  UNIQUE KEY uq_blog_source_hash (source_content_hash),
  INDEX idx_blog_status (status),
  INDEX idx_blog_published (published_at),
  INDEX idx_blog_created (created_at),
  CONSTRAINT fk_blog_author FOREIGN KEY (author_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_import_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_key VARCHAR(64) NOT NULL,
  source_type ENUM('csv','json','manual') NOT NULL DEFAULT 'csv',
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  total_rows INT NOT NULL DEFAULT 0,
  imported_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  options_json JSON NULL,
  created_by_admin_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_import_batch_key (batch_key),
  CONSTRAINT fk_import_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_ai_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_type ENUM('rewrite_single','rewrite_bulk','seo_generate','seo_bulk') NOT NULL,
  status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  post_id INT NULL,
  batch_id VARCHAR(64) NULL,
  payload_json JSON NULL,
  result_json JSON NULL,
  error_message TEXT NULL,
  created_by_admin_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  INDEX idx_ai_jobs_status (status),
  INDEX idx_ai_jobs_batch (batch_id),
  INDEX idx_ai_jobs_post (post_id),
  CONSTRAINT fk_ai_job_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_job_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;