'use strict';

/**
 * Compare two period values for dashboard KPI footers.
 * Avoids misleading +100% when prior is zero.
 */
function formatPeriodDelta(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0 && c === 0) {
    return { label: '—', direction: 'flat', cssClass: 'delta--flat' };
  }
  if (p === 0 && c > 0) {
    return { label: 'New', direction: 'up', cssClass: 'delta--up' };
  }
  const pct = Math.round(((c - p) / p) * 100);
  if (pct === 0) {
    return { label: '—', direction: 'flat', cssClass: 'delta--flat' };
  }
  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs prior`,
    direction: pct > 0 ? 'up' : 'down',
    cssClass: pct > 0 ? 'delta--up' : 'delta--down',
  };
}

function formatInrFromPaise(paise) {
  const n = Number(paise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

module.exports = { formatPeriodDelta, formatInrFromPaise };