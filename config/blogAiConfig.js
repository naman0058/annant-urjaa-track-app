'use strict';

function intEnv(name, fallback, { min = 1, max = 100 } = {}) {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function floatEnv(name, fallback, { min = 0, max = 100000 } = {}) {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : parseFloat(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const blogAiConfig = Object.freeze({
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  maxConcurrent: intEnv('OPENAI_MAX_CONCURRENT_REQUESTS', 2, { min: 1, max: 8 }),
  maxRetries: intEnv('OPENAI_MAX_RETRIES', 3, { min: 0, max: 8 }),
  requestTimeoutMs: intEnv('OPENAI_REQUEST_TIMEOUT', 180000, { min: 15000, max: 600000 }),
  importDir: process.env.BLOG_IMPORT_DIR || '',
  defaultAuthor: process.env.BLOG_DEFAULT_AUTHOR || 'Editorial Team',
  siteBaseUrl: (process.env.SITE_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000')
    .replace(/\/$/, ''),
  importMaxFileBytes: intEnv('BLOG_IMPORT_MAX_FILE_BYTES', 2 * 1024 * 1024, {
    min: 4096,
    max: 25 * 1024 * 1024,
  }),
  importNestedDirs: boolEnv('BLOG_IMPORT_NESTED_DIRS', true),
  importEnableDocx: boolEnv('BLOG_IMPORT_ENABLE_DOCX', true),
  importBatchSize: intEnv('BLOG_IMPORT_BATCH_SIZE', 2, { min: 1, max: 20 }),
  importWorkerStaleMinutes: intEnv('BLOG_IMPORT_WORKER_STALE_MINUTES', 8, { min: 2, max: 60 }),
  importBudgetUsd: floatEnv('BLOG_IMPORT_BUDGET_USD', 0, { min: 0, max: 10000 }),
  /** When true, folder import jobs publish posts to the site after AI processing (unless unchecked in studio). */
  importAutoPublish: boolEnv('BLOG_IMPORT_AUTO_PUBLISH', true),
});

function assertOpenAIConfigured() {
  if (!blogAiConfig.openaiApiKey) {
    const err = new Error('OPENAI_API_KEY is not configured on the server');
    err.code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }
}

module.exports = { blogAiConfig, assertOpenAIConfigured };