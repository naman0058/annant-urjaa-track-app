'use strict';

const esbuild = require('esbuild');
const path = require('path');

const entry = path.join(__dirname, '..', 'public', 'js', 'blog-editor', 'index.js');
const outfile = path.join(__dirname, '..', 'public', 'js', 'admin-blog-editor.bundle.js');

esbuild
  .build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    logLevel: 'info',
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });