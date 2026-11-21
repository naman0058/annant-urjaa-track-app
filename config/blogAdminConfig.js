'use strict';

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

/** Admin UI + routes for blog modules (see .env.example). */
const blogAdminConfig = Object.freeze({
  /** Sidebar “Blog CMS” + /admin/blog list & edit */
  cmsEnabled: boolEnv('ADMIN_BLOG_CMS_ENABLED', true),
  /** Sidebar “Folder import” + /admin/blogs/* */
  folderImportEnabled: boolEnv('ADMIN_BLOG_FOLDER_IMPORT_ENABLED', false),
  newPost: boolEnv('ADMIN_BLOG_NEW_POST', false),
  importCsv: boolEnv('ADMIN_BLOG_IMPORT_CSV', false),
  ai: boolEnv('ADMIN_BLOG_AI', false),
  trash: boolEnv('ADMIN_BLOG_TRASH', false),
  /** Post detail page + “View” in row menu (default off = list links go to edit). */
  postDetail: boolEnv('ADMIN_BLOG_POST_DETAIL', false),
});

function featureDisabledResponse(req, res) {
  req.flash('error', 'That blog tool is disabled.');
  return res.redirect('/admin/blog');
}

module.exports = { blogAdminConfig, featureDisabledResponse };