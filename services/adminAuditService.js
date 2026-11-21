'use strict';

async function logAdminAudit(db, { adminId, action, entityType, entityId, metadata = {} }) {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (admin_id, action, entity_type, entity_id, metadata_json)
       VALUES (:admin_id, :action, :entity_type, :entity_id, :metadata_json)`,
      {
        admin_id: adminId || null,
        action: String(action).slice(0, 80),
        entity_type: String(entityType || 'admin').slice(0, 40),
        entity_id: entityId != null ? String(entityId) : null,
        metadata_json: JSON.stringify(metadata || {}),
      }
    );
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('admin audit', err.message);
  }
}

function buildAuditWhere(filters = {}) {
  const clauses = [];
  const params = {};
  const action = String(filters.action || '').trim();
  if (action) {
    clauses.push('a.action LIKE :action');
    params.action = `%${action.slice(0, 80)}%`;
  }
  const entityType = String(filters.entity_type || '').trim();
  if (entityType) {
    clauses.push('a.entity_type = :entity_type');
    params.entity_type = entityType.slice(0, 40);
  }
  const actor = String(filters.actor || '').trim();
  if (actor) {
    clauses.push('ad.email LIKE :actor');
    params.actor = `%${actor.slice(0, 120)}%`;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params };
}

function countAuditActiveFilters(filters = {}) {
  let n = 0;
  if (filters.action) n += 1;
  if (filters.entity_type) n += 1;
  if (filters.actor) n += 1;
  return n;
}

async function listAdminAudit(db, { page = 1, limit = 30, action = '', entity_type = '', actor = '' } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 10), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const { where, params: whereParams } = buildAuditWhere({ action, entity_type, actor });
  const params = { ...whereParams, limit: safeLimit, offset };
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM admin_audit_logs a
     LEFT JOIN admins ad ON ad.id = a.admin_id
     ${where}`,
    params
  );
  const [rows] = await db.query(
    `SELECT a.*, ad.email AS actor_email FROM admin_audit_logs a
     LEFT JOIN admins ad ON ad.id = a.admin_id
     ${where} ORDER BY a.created_at DESC LIMIT :limit OFFSET :offset`,
    params
  );
  const totalN = Number(total) || 0;
  const totalPages = Math.max(1, Math.ceil(totalN / safeLimit));
  return {
    rows,
    pagination: { page: safePage, limit: safeLimit, total: totalN, totalPages },
  };
}

async function getAdminAuditById(db, id) {
  const [rows] = await db.query(
    `SELECT a.*, ad.email AS actor_email FROM admin_audit_logs a
     LEFT JOIN admins ad ON ad.id = a.admin_id
     WHERE a.id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

module.exports = {
  logAdminAudit,
  listAdminAudit,
  getAdminAuditById,
  countAuditActiveFilters,
  buildAuditWhere,
};