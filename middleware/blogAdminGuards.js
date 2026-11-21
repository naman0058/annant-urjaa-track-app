'use strict';

const { blogAdminConfig, featureDisabledResponse } = require('../config/blogAdminConfig');

function requireBlogCms(_req, res, next) {
  if (!blogAdminConfig.cmsEnabled) {
    return res.status(404).render('404', { title: 'Not Found', layout: false });
  }
  next();
}

function requireFolderImport(_req, res, next) {
  if (!blogAdminConfig.folderImportEnabled) {
    return res.status(404).render('404', { title: 'Not Found', layout: false });
  }
  next();
}

function requireBlogNewPost(req, res, next) {
  if (!blogAdminConfig.newPost) return featureDisabledResponse(req, res);
  next();
}

function requireBlogImportCsv(req, res, next) {
  if (!blogAdminConfig.importCsv) return featureDisabledResponse(req, res);
  next();
}

function requireBlogAi(req, res, next) {
  if (!blogAdminConfig.ai) return featureDisabledResponse(req, res);
  next();
}

function requireBlogTrash(req, res, next) {
  if (!blogAdminConfig.trash) return featureDisabledResponse(req, res);
  next();
}

function blogAdminLocals(_req, res, next) {
  res.locals.blogAdmin = blogAdminConfig;
  next();
}

module.exports = {
  blogAdminLocals,
  requireBlogCms,
  requireFolderImport,
  requireBlogNewPost,
  requireBlogImportCsv,
  requireBlogAi,
  requireBlogTrash,
};