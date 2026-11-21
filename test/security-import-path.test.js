'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('import path security', () => {
  it('rejects path traversal', () => {
    process.env.BLOG_IMPORT_DIR = path.join(os.tmpdir(), 'blog-import-test');
    fs.mkdirSync(process.env.BLOG_IMPORT_DIR, { recursive: true });
    delete require.cache[require.resolve('../config/blogAiConfig')];
    delete require.cache[require.resolve('../services/import/importPath')];
    const { resolveInsideImportRoot } = require('../services/import/importPath');
    assert.throws(() => resolveInsideImportRoot('../../../etc/passwd'), /Invalid|escapes/);
  });

  it('rejects absolute user paths', () => {
    process.env.BLOG_IMPORT_DIR = path.join(os.tmpdir(), 'blog-import-test2');
    fs.mkdirSync(process.env.BLOG_IMPORT_DIR, { recursive: true });
    delete require.cache[require.resolve('../config/blogAiConfig')];
    delete require.cache[require.resolve('../services/import/importPath')];
    const { resolveRelativeFile } = require('../services/import/importPath');
    assert.throws(() => resolveRelativeFile('C:/windows/system32/cmd.exe'), /Invalid|escapes/);
  });
});