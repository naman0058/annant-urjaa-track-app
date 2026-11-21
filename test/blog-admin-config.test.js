'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('blogAdminConfig env flags', () => {
  const saved = {};

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('ADMIN_BLOG_')) saved[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    delete require.cache[require.resolve('../config/blogAdminConfig')];
  });

  it('defaults to CMS on, tools off', () => {
    for (const k of Object.keys(saved)) delete process.env[k];
    delete require.cache[require.resolve('../config/blogAdminConfig')];
    const { blogAdminConfig } = require('../config/blogAdminConfig');
    assert.equal(blogAdminConfig.cmsEnabled, true);
    assert.equal(blogAdminConfig.folderImportEnabled, false);
    assert.equal(blogAdminConfig.newPost, false);
    assert.equal(blogAdminConfig.importCsv, false);
    assert.equal(blogAdminConfig.ai, false);
    assert.equal(blogAdminConfig.trash, false);
    assert.equal(blogAdminConfig.postDetail, false);
  });
});