'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireRole } = require('../../middleware/adminAuth');
const { logAdminAudit } = require('../../services/adminAuditService');

const router = express.Router();
const canManage = requireRole(['super']);
const canView = requireRole(['super', 'manager']);

function buildStaffQueryString(filters, extra = {}) {
  const p = new URLSearchParams();
  const f = filters || {};
  ['q', 'role', 'active', 'sort', 'dir', 'limit'].forEach((k) => {
    const v = f[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      if (k === 'role' && v === 'all') return;
      if (k === 'active' && v === 'all') return;
      p.set(k, String(v).trim());
    }
  });
  Object.keys(extra || {}).forEach((k) => {
    if (extra[k] !== undefined && extra[k] !== null) p.set(k, extra[k]);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

function countStaffActiveFilters(filters) {
  let n = 0;
  if (String(filters.q || '').trim()) n++;
  if (filters.role && filters.role !== 'all') n++;
  if (filters.active && filters.active !== 'all') n++;
  if (filters.sort && filters.sort !== 'created_at') n++;
  if (filters.dir && filters.dir !== 'desc') n++;
  if (filters.limit && Number(filters.limit) !== 20) n++;
  return n;
}

function staffListHasUserFilters(filters) {
  return countStaffActiveFilters(filters) > 0;
}

function staffRedirectAfterWrite(req) {
  const ret = String(req.body._list_return || '').trim();
  if (ret) return `/admin/staff?${ret}`;
  return '/admin/staff';
}

const csvEscape = (v) => {
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/"/g, '""')}"`;
};

router.get('/staff', requireAuth, canView, async (req, res) => {
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
  const offset = (page - 1) * limit;

  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || 'all').trim();
  const active = String(req.query.active || 'all').trim();
  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 'a.created_at',
    name: 'a.name',
    email: 'a.email',
    role: 'a.role',
    id: 'a.id',
  };
  const sortSql = SORT_MAP[sort] || 'a.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = { limit, offset };

  if (q) {
    where.push('(a.name LIKE :q OR a.email LIKE :q)');
    params.q = `%${q}%`;
  }
  if (role && role !== 'all') {
    where.push('a.role = :role');
    params.role = role;
  }
  if (active === '1') {
    where.push('COALESCE(a.is_active, 1) = 1');
  } else if (active === '0') {
    where.push('COALESCE(a.is_active, 1) = 0');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const filters = { q, role, active, sort, dir, limit };

  try {
    const [[{ total }]] = await req.db.query(
      `SELECT COUNT(*) AS total FROM admins a ${whereSql}`,
      params
    );
    const [rows] = await req.db.query(
      `SELECT a.id, a.name, a.email, a.role, COALESCE(a.is_active, 1) AS is_active, a.created_at
       FROM admins a
       ${whereSql}
       ORDER BY ${sortSql} ${dirSql}
       LIMIT :limit OFFSET :offset`,
      params
    );
    const totalPages = Math.max(1, Math.ceil(Number(total) / limit));
    const listReturnQs = buildStaffQueryString(filters).replace(/^\?/, '');

    res.render('staff-list', {
      title: 'Staff & roles',
      staff: rows,
      filters,
      pagination: { page, limit, total, totalPages },
      activeFilterCount: countStaffActiveFilters(filters),
      datasetEmpty: Number(total) === 0 && !staffListHasUserFilters(filters),
      listReturnQs,
      qsBase: (extra) => buildStaffQueryString(filters, extra),
      canManageStaff: req.session.admin.role === 'super',
    });
  } catch (err) {
    console.error('staff list', err.message);
    req.flash('error', 'Could not load staff.');
    res.render('staff-list', {
      title: 'Staff & roles',
      staff: [],
      filters,
      pagination: { page: 1, limit, total: 0, totalPages: 1 },
      activeFilterCount: countStaffActiveFilters(filters),
      datasetEmpty: false,
      listReturnQs: '',
      qsBase: (extra) => buildStaffQueryString(filters, extra),
      canManageStaff: req.session.admin.role === 'super',
    });
  }
});

router.get('/staff.csv', requireAuth, canView, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || 'all').trim();
  const active = String(req.query.active || 'all').trim();
  const sort = String(req.query.sort || 'created_at').trim();
  const dir = String(req.query.dir || 'desc').trim().toLowerCase();

  const SORT_MAP = {
    created_at: 'a.created_at',
    name: 'a.name',
    email: 'a.email',
    role: 'a.role',
    id: 'a.id',
  };
  const sortSql = SORT_MAP[sort] || 'a.created_at';
  const dirSql = dir === 'asc' ? 'ASC' : 'DESC';

  const where = [];
  const params = {};
  if (q) {
    where.push('(a.name LIKE :q OR a.email LIKE :q)');
    params.q = `%${q}%`;
  }
  if (role && role !== 'all') {
    where.push('a.role = :role');
    params.role = role;
  }
  if (active === '1') where.push('COALESCE(a.is_active, 1) = 1');
  else if (active === '0') where.push('COALESCE(a.is_active, 1) = 0');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const [rows] = await req.db.query(
      `SELECT id, name, email, role, COALESCE(is_active, 1) AS is_active, created_at
       FROM admins a ${whereSql} ORDER BY ${sortSql} ${dirSql} LIMIT 5000`,
      params
    );
    const header = ['id', 'name', 'email', 'role', 'is_active', 'created_at'].map(csvEscape).join(',') + '\n';
    const lines = rows
      .map((r) =>
        [r.id, r.name, r.email, r.role, r.is_active ? 1 : 0, r.created_at].map(csvEscape).join(',')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="staff.csv"');
    res.send(header + lines);
  } catch (e) {
    console.error(e);
    res.status(500).send('Failed to export CSV');
  }
});

router.get('/staff/new', requireAuth, canManage, (req, res) => {
  res.redirect('/admin/staff');
});

router.post(
  '/staff',
  requireAuth,
  canManage,
  body('email').isEmail(),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.flash('error', 'Valid email and password (8+ chars) required.');
      return res.redirect(staffRedirectAfterWrite(req));
    }
    const { name, email, password, role } = req.body;
    const safeRole = ['super', 'manager', 'viewer'].includes(role) ? role : 'manager';
    try {
      const hash = await bcrypt.hash(password, 10);
      const [r] = await req.db.query(
        `INSERT INTO admins (name, email, password_hash, role, is_active) VALUES (:name, :email, :hash, :role, 1)`,
        { name: String(name).trim(), email, hash, role: safeRole }
      );
      await logAdminAudit(req.db, {
        adminId: req.session.admin.id,
        action: 'staff_create',
        entityType: 'admin',
        entityId: r.insertId,
        metadata: { email, role: safeRole },
      });
      req.flash('success', 'Staff member created.');
    } catch (err) {
      console.error(err);
      req.flash('error', err.code === 'ER_DUP_ENTRY' ? 'Email already exists.' : 'Could not create staff.');
    }
    res.redirect(staffRedirectAfterWrite(req));
  }
);

router.get('/staff/:id', requireAuth, canView, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.redirect('/admin/staff');
  const [rows] = await req.db.query(
    `SELECT id, name, email, role, COALESCE(is_active, 1) AS is_active, created_at FROM admins WHERE id = :id`,
    { id }
  );
  if (!rows[0]) {
    req.flash('error', 'Staff member not found');
    return res.redirect('/admin/staff');
  }
  let audit = [];
  try {
    const [logs] = await req.db.query(
      `SELECT al.*, ad.email AS actor_email
       FROM admin_audit_logs al
       LEFT JOIN admins ad ON ad.id = al.admin_id
       WHERE al.entity_type = 'admin' AND al.entity_id = :eid
       ORDER BY al.created_at DESC
       LIMIT 15`,
      { eid: String(id) }
    );
    audit = logs || [];
  } catch {
    audit = [];
  }
  const returnQs = String(req.query.return || '').trim();
  res.render('staff-detail', {
    title: rows[0].name || 'Staff',
    member: rows[0],
    auditLogs: audit,
    returnQs,
    canManageStaff: req.session.admin.role === 'super',
  });
});

router.get('/staff/:id/edit', requireAuth, canManage, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ret = String(req.query.return || '').trim();
  const qs = ret ? `?return=${encodeURIComponent(ret)}` : '';
  res.redirect(`/admin/staff/${id}${qs}`);
});

router.post('/staff/:id', requireAuth, canManage, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const selfId = req.session.admin.id;
  const backDetail = req.body._redirect === 'detail';

  if (id === selfId && req.body.role && req.body.role !== req.session.admin.role) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect(backDetail ? `/admin/staff/${id}` : staffRedirectAfterWrite(req));
  }
  const role = ['super', 'manager', 'viewer'].includes(req.body.role) ? req.body.role : 'manager';
  const isActive = req.body.is_active === '1' ? 1 : 0;
  if (id === selfId && !isActive) {
    req.flash('error', 'You cannot deactivate your own account.');
    return res.redirect(backDetail ? `/admin/staff/${id}` : staffRedirectAfterWrite(req));
  }
  try {
    await req.db.query(`UPDATE admins SET name = :name, role = :role, is_active = :active WHERE id = :id`, {
      id,
      name: String(req.body.name).trim(),
      role,
      active: isActive,
    });
    if (req.body.password && String(req.body.password).length >= 8) {
      const hash = await bcrypt.hash(req.body.password, 10);
      await req.db.query(`UPDATE admins SET password_hash = :hash WHERE id = :id`, { id, hash });
    } else if (req.body.password && String(req.body.password).length > 0) {
      req.flash('error', 'Password must be at least 8 characters.');
      return res.redirect(backDetail ? `/admin/staff/${id}` : staffRedirectAfterWrite(req));
    }
    await logAdminAudit(req.db, {
      adminId: selfId,
      action: 'staff_update',
      entityType: 'admin',
      entityId: id,
      metadata: { role, is_active: isActive },
    });
    req.flash('success', 'Staff updated.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update staff.');
  }
  if (backDetail) {
    const ret = String(req.body._list_return || '').trim();
    const qs = ret ? `?return=${encodeURIComponent(ret)}` : '';
    return res.redirect(`/admin/staff/${id}${qs}`);
  }
  res.redirect(staffRedirectAfterWrite(req));
});

module.exports = router;