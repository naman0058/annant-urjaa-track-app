(function () {
  'use strict';

  const payloadEl = document.getElementById('reportsChartPayload');
  if (!payloadEl || !window.AdminCharts) return;

  let payload;
  try {
    payload = JSON.parse(payloadEl.textContent);
  } catch {
    return;
  }

  const {
    salesSeries = [],
    subsSeries = [],
    memberSeries = [],
    txStatusBreakdown = [],
    topTracks = [],
    revenueByTrack = [],
    revenueByTrackAvailable = false,
    activeTracksByTrack = [],
    granularity = 'daily',
    stats = {},
    chartMeta = {},
    periodBreakdown = [],
    tab = 'overview',
  } = payload;

  const C = window.AdminCharts;
  const charts = [];

  function sumSeries(rows) {
    return (rows || []).reduce((s, r) => s + Number(r.y || 0), 0);
  }

  if (document.getElementById('reportsRevenueChart')) {
    const ch = C.revenueChart(
      'reportsRevenueChart',
      'reportsRevenueWrap',
      'reportsRevenueEmpty',
      salesSeries,
      granularity,
      stats.salesAmount ?? chartMeta.salesAmountKpi
    );
    if (ch) charts.push(ch);
  }

  if (document.getElementById('reportsTxStatusChart')) {
    const ch = C.statusChart(
      'reportsTxStatusChart',
      'reportsTxStatusWrap',
      'reportsTxStatusEmpty',
      txStatusBreakdown,
      'reportsTxStatusLegend'
    );
    if (ch) charts.push(ch);
  }

  if (document.getElementById('reportsSubsChart')) {
    const ch = C.barChart(
      'reportsSubsChart',
      'reportsSubsWrap',
      'reportsSubsEmpty',
      subsSeries,
      granularity,
      'rgba(116, 169, 239, 0.5)',
      stats.subsCount
    );
    if (ch) charts.push(ch);
  }

  if (document.getElementById('reportsMembersChart')) {
    const ch = C.barChart(
      'reportsMembersChart',
      'reportsMembersWrap',
      'reportsMembersEmpty',
      memberSeries,
      granularity,
      'rgba(116, 169, 239, 0.45)',
      stats.totalUsers
    );
    if (ch) charts.push(ch);
  }

  const metricSelect = document.getElementById('reportsTopTracksMetric');
  let topTracksChart = null;

  function rowsForMetric(metric) {
    if (metric === 'revenue' && revenueByTrackAvailable) {
      return revenueByTrack.map((r) => ({
        track_id: r.track_id,
        title: r.title,
        revenue_paise: r.revenue_paise,
      }));
    }
    if (metric === 'active') {
      return activeTracksByTrack;
    }
    return topTracks;
  }

  function metricHasData(metric) {
    if (metric === 'revenue') {
      return (
        revenueByTrackAvailable &&
        rowsForMetric('revenue').some((r) => Number(r.revenue_paise || 0) > 0)
      );
    }
    if (metric === 'active') {
      return rowsForMetric('active').some((r) => Number(r.cnt || 0) > 0);
    }
    return (
      rowsForMetric('subscriptions').some((r) => Number(r.cnt || 0) > 0) ||
      Number(stats.subsCount || 0) > 0
    );
  }

  function defaultMetric() {
    if (metricHasData('revenue')) return 'revenue';
    if (metricHasData('subscriptions')) return 'subscriptions';
    if (metricHasData('active')) return 'active';
    return revenueByTrackAvailable ? 'revenue' : 'subscriptions';
  }

  function renderTopTracksChart(metric) {
    const emptyEl = document.getElementById('reportsTopTracksEmpty');
    const emptyMsg = emptyEl && emptyEl.querySelector('[data-empty-msg]');
    const rows = rowsForMetric(metric);
    const valueKey = metric === 'revenue' ? 'revenue_paise' : 'cnt';
    const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0);
    if (emptyMsg) {
      emptyMsg.textContent =
        metric === 'revenue'
          ? 'No captured revenue for tracks in this period.'
          : metric === 'active'
            ? 'No active subscriptions on tracks.'
            : 'No track activity in this period.';
    }
    if (topTracksChart) {
      topTracksChart.destroy();
      topTracksChart = null;
    }
    if (total <= 0) {
      C.setChartEmpty('reportsTopTracksWrap', 'reportsTopTracksChart', 'reportsTopTracksEmpty', true);
      return;
    }
    const opts =
      metric === 'revenue'
        ? { valueKey: 'revenue_paise', scale: 100, tickFmt: (v) => '₹' + Number(v).toLocaleString('en-IN') }
        : { valueKey: 'cnt', scale: 1 };
    topTracksChart = C.horizontalBarChart(
      'reportsTopTracksChart',
      'reportsTopTracksWrap',
      'reportsTopTracksEmpty',
      rows,
      opts
    );
    if (topTracksChart) charts.push(topTracksChart);
  }

  function syncMetricOptions() {
    if (!metricSelect) return;
    const revOpt = metricSelect.querySelector('option[data-metric="revenue"]');
    if (revOpt) revOpt.disabled = !revenueByTrackAvailable;
  }

  if (document.getElementById('reportsTopTracksChart')) {
    syncMetricOptions();
    const initial = metricSelect ? metricSelect.value || defaultMetric() : defaultMetric();
    if (metricSelect) metricSelect.value = initial;
    renderTopTracksChart(initial);
    if (metricSelect) {
      metricSelect.addEventListener('change', () => renderTopTracksChart(metricSelect.value));
    }
  }

  if (document.getElementById('reportsBreakdownTable')) {
    const tbody = document.querySelector('#reportsBreakdownTable tbody');
    const tableWrap = document.getElementById('breakdownTableWrap');
    const filteredEmpty = document.getElementById('breakdownFilteredEmpty');
    const pager = document.getElementById('breakdownPager');
    const pageInfo = document.getElementById('breakdownPageInfo');
    const hideZeros = document.getElementById('breakdownHideZeros');
    const pageSizeSel = document.getElementById('breakdownPageSize');
    const prevBtn = document.getElementById('breakdownPrev');
    const nextBtn = document.getElementById('breakdownNext');
    const firstBtn = document.getElementById('breakdownFirst');
    const lastBtn = document.getElementById('breakdownLast');
    const allRows = [...(periodBreakdown || [])];
    let page = 1;

    function rowHasActivity(r) {
      return (
        Number(r.revenue_paise || 0) > 0 ||
        Number(r.transactions || 0) > 0 ||
        Number(r.subscriptions || 0) > 0 ||
        Number(r.members || 0) > 0
      );
    }

    function formatPeriodLabel(iso) {
      if (C.formatLabel) return C.formatLabel(iso, granularity);
      return iso;
    }

    function visibleRows() {
      let rows = allRows;
      if (hideZeros && hideZeros.checked) {
        rows = rows.filter(rowHasActivity);
      }
      return rows;
    }

    function inr(paise) {
      return C.rupees(paise);
    }

    function renderBreakdown() {
      if (!tbody) return;
      const pageSize = pageSizeSel ? parseInt(pageSizeSel.value, 10) || 12 : 12;
      const rows = visibleRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      if (page > totalPages) page = totalPages;
      if (page < 1) page = 1;

      const emptyView = rows.length === 0;
      if (tableWrap) tableWrap.hidden = emptyView;
      if (filteredEmpty) filteredEmpty.hidden = !emptyView;
      if (pager) pager.hidden = emptyView;

      if (emptyView) return;

      const start = (page - 1) * pageSize;
      const slice = rows.slice(start, start + pageSize);
      const end = start + slice.length;

      tbody.innerHTML = slice
        .map((row) => {
          const zeroRow = !rowHasActivity(row);
          return `<tr class="${zeroRow ? 'breakdownRow--zero' : ''}"><td class="mono breakdownCol--period">${formatPeriodLabel(row.period)}</td><td class="mono col-amount">${inr(row.revenue_paise)}</td><td class="mono col-num">${row.transactions}</td><td class="mono col-num">${row.subscriptions}</td><td class="mono col-num">${row.members}</td></tr>`;
        })
        .join('');

      if (pageInfo) {
        pageInfo.textContent = `Showing ${start + 1}–${end} of ${rows.length}`;
      }

      if (firstBtn) firstBtn.disabled = page <= 1;
      if (prevBtn) prevBtn.disabled = page <= 1;
      if (nextBtn) nextBtn.disabled = page >= totalPages;
      if (lastBtn) lastBtn.disabled = page >= totalPages;
    }

    const activeRows = allRows.filter(rowHasActivity);
    const pageSizeInit = pageSizeSel ? parseInt(pageSizeSel.value, 10) || 12 : 12;
    if (activeRows.length > 0 && hideZeros && hideZeros.checked) {
      page = Math.max(1, Math.ceil(activeRows.length / pageSizeInit));
    }

    if (hideZeros) hideZeros.addEventListener('change', () => { page = 1; renderBreakdown(); });
    if (pageSizeSel) pageSizeSel.addEventListener('change', () => { page = 1; renderBreakdown(); });
    if (firstBtn) firstBtn.addEventListener('click', () => { page = 1; renderBreakdown(); });
    if (prevBtn) prevBtn.addEventListener('click', () => { page -= 1; renderBreakdown(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { page += 1; renderBreakdown(); });
    if (lastBtn) {
      lastBtn.addEventListener('click', () => {
        const pageSize = pageSizeSel ? parseInt(pageSizeSel.value, 10) || 12 : 12;
        page = Math.max(1, Math.ceil(visibleRows().length / pageSize));
        renderBreakdown();
      });
    }
    renderBreakdown();
  }

  const presetSelect = document.getElementById('reportsPresetSelect');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const params = new URLSearchParams();
      params.set('preset', presetSelect.value);
      const form = document.getElementById('reportsPresetForm');
      if (form) {
        form.querySelectorAll('input[type="hidden"]').forEach((el) => {
          if (el.name && el.value) params.set(el.name, el.value);
        });
      }
      window.location.assign('/admin/reports?' + params.toString());
    });
  }

  if (chartMeta.revenueReconciled === false) {
    console.warn('Reports revenue chart does not reconcile with KPI.');
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => C.resizeCharts(charts));
    const page = document.querySelector('[data-reports]');
    if (page) ro.observe(page);
  }
  window.addEventListener('resize', () => C.resizeCharts(charts));
})();