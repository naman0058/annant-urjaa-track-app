'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const { listAdminAudit, countAuditActiveFilters } = require('../../services/adminAuditService');

const router = express.Router();

function parseAuditFilters(query) {
  return {
    action: String(query.action || '').trim(),
    entity_type: String(query.entity_type || '').trim(),
    actor: String(query.actor || '').trim(),
    page: Math.max(parseInt(query.page, 10) || 1, 1),
    limit: Math.min(Math.max(parseInt(query.limit, 10) || 40, 10), 100),
  };
}

function buildAuditQs(filters, overrides = {}) {
  const merged = { ...filters, ...overrides };
  const p = new URLSearchParams();
  if (merged.action) p.set('action', merged.action);
  if (merged.entity_type) p.set('entity_type', merged.entity_type);
  if (merged.actor) p.set('actor', merged.actor);
  if (merged.limit && merged.limit !== 40) p.set('limit', String(merged.limit));
  if (merged.page && merged.page > 1) p.set('page', String(merged.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

router.get('/audit', requireAuth, requireRole(['super', 'manager']), async (req, res) => {
  const filters = parseAuditFilters(req.query);
  const qsBase = (overrides) => buildAuditQs(filters, overrides);
  try {
    const { rows, pagination } = await listAdminAudit(req.db, filters);
    let datasetEmpty = rows.length === 0;
    try {
      const [[row]] = await req.db.query(`SELECT COUNT(*) AS c FROM admin_audit_logs`);
      datasetEmpty = Number(row.c) === 0;
    } catch {
      datasetEmpty = rows.length === 0;
    }
    res.render('admin-audit', {
      title: 'Audit log',
      rows,
      pagination,
      filters,
      activeFilterCount: countAuditActiveFilters(filters),
      datasetEmpty,
      qsBase,
    });
  } catch (err) {
    console.error('audit list', err.message);
    req.flash('error', 'Audit log unavailable. Run npm run migrate:admin.');
    res.render('admin-audit', {
      title: 'Audit log',
      rows: [],
      pagination: { page: 1, limit: 40, total: 0, totalPages: 1 },
      filters,
      activeFilterCount: countAuditActiveFilters(filters),
      datasetEmpty: true,
      qsBase,
    });
  }
});

module.exports = router;