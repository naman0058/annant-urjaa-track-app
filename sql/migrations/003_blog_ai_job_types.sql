-- Expand AI job types (non-destructive; widens column for new workflow labels)
ALTER TABLE blog_ai_jobs
  MODIFY COLUMN job_type VARCHAR(48) NOT NULL;