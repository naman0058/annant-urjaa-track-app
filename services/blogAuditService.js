'use strict';

async function logBlogAudit(db, { adminId, action, entityType, entityId, metadata = {} }) {
  await db.query(
    `
    INSERT INTO blog_audit_logs (admin_id, action, entity_type, entity_id, metadata_json)
    VALUES (:admin_id, :action, :entity_type, :entity_id, :metadata_json)
    `,
    {
      admin_id: adminId || null,
      action: String(action).slice(0, 80),
      entity_type: String(entityType || 'blog_post').slice(0, 40),
      entity_id: entityId || null,
      metadata_json: JSON.stringify(metadata || {}),
    }
  );
}

module.exports = { logBlogAudit };