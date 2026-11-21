'use strict';

const TX_STATUS_LABELS = {
  created: 'Created',
  authorized: 'Authorized',
  captured: 'Captured',
  failed: 'Failed',
  refunded: 'Refunded',
  in_transit: 'In transit',
};

const TX_STATUS_BADGE = {
  captured: 'success',
  failed: 'danger',
  refunded: 'warning',
  in_transit: 'warning',
  created: 'info',
  authorized: 'info',
};

function formatTxStatus(status) {
  if (!status) return '—';
  const key = String(status).toLowerCase();
  return TX_STATUS_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function txStatusBadgeClass(status) {
  const key = String(status || '').toLowerCase();
  return TX_STATUS_BADGE[key] || 'info';
}

function shortOrderId(orderId, max = 14) {
  const s = String(orderId || '').trim();
  if (!s) return '—';
  if (s.length <= max) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatTxDateTime(value, timeZone = 'Asia/Kolkata') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(d);
}

/** List tables: date only (no time). */
function formatTxDate(value, timeZone = 'Asia/Kolkata') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(d);
}

module.exports = {
  formatTxStatus,
  txStatusBadgeClass,
  shortOrderId,
  formatTxDateTime,
  formatTxDate,
};