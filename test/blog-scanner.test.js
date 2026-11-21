'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('folder scanner', () => {
  it('skips unsupported and hidden files', async () => {
    const root = path.join(os.tmpdir(), `scan-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'good.md'), '# Title\n\n'.repeat(30));
    fs.writeFileSync(path.join(root, '.hidden.md'), 'x');
    fs.writeFileSync(path.join(root, 'virus.exe'), 'MZ');

    process.env.BLOG_IMPORT_DIR = root;
    delete require.cache[require.resolve('../config/blogAiConfig')];
    delete require.cache[require.resolve('../services/import/folderScanner')];

    const { scanImportFolder } = require('../services/import/folderScanner');
    const scan = await scanImportFolder({ subdir: '.', nested: false });
    assert.equal(scan.summary.supported, 1);
    assert.ok(scan.entries.some((e) => e.status === 'unsupported' && e.ext === '.exe'));
  });
});