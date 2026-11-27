-- Non-destructive: speeds cursor pagination (ORDER BY published_at DESC, id DESC) on published posts.
-- Safe to re-run only via migrate script that checks index existence.

CREATE INDEX idx_blog_published_id ON blog_posts (published_at, id);