(function () {
  'use strict';

  const payloadEl = document.getElementById('dashboardChartPayload');
  if (!payloadEl) return;

  let payload;
  try {
    payload = JSON.parse(payloadEl.textContent);
  } catch {
    return;
  }

  const AC = window.AdminCharts;
  if (!AC) return;

  const {
    salesSeries = [],
    subsSeries = [],
    granularity = 'daily',
    stats = {},
    chartMeta = {},
  } = payload;

  const revenueKpi = Number(stats.salesAmount ?? chartMeta.salesAmountKpi ?? 0);
  const seriesRevenue = (salesSeries || []).reduce((s, r) => s + Number(r.y || 0), 0);

  if (typeof Chart !== 'undefined') {
    AC.revenueChart(
      'revenueChart',
      'revenueChartWrap',
      'revenueChartEmpty',
      salesSeries,
      granularity,
      revenueKpi
    );
    if (chartMeta.revenueReconciled === false && typeof console !== 'undefined') {
      console.warn(
        'Dashboard revenue chart series does not match KPI:',
        seriesRevenue,
        revenueKpi
      );
    }

    const subsKpi = Number(stats.subsCount ?? 0);
    AC.barChart(
      'subsChart',
      'subsChartWrap',
      'subsChartEmpty',
      subsSeries,
      granularity,
      'rgba(116, 169, 239, 0.5)',
      subsKpi
    );
  }

  const presetSelect = document.getElementById('dashPresetSelect');
  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const params = new URLSearchParams();
      params.set('preset', presetSelect.value);
      const form = document.getElementById('dashPresetForm');
      if (form) {
        form.querySelectorAll('input[type="hidden"]').forEach((el) => {
          if (el.name && el.value) params.set(el.name, el.value);
        });
      }
      window.location.assign('/admin/dashboard?' + params.toString());
    });
  }

  const refreshBtn = document.getElementById('dashRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => window.location.reload());
  }

  const filterForm = document.getElementById('dashFiltersForm');
  const fromInput = document.getElementById('filterFrom');
  const toInput = document.getElementById('filterTo');
  const dateError = document.getElementById('filterDateError');

  if (filterForm && fromInput && toInput) {
    filterForm.addEventListener('submit', (e) => {
      if (!fromInput.value || !toInput.value) return;
      if (fromInput.value > toInput.value) {
        e.preventDefault();
        if (dateError) {
          dateError.textContent = 'From date cannot be after to date.';
          dateError.hidden = false;
        }
        toInput.setAttribute('aria-invalid', 'true');
      } else if (dateError) {
        dateError.hidden = true;
        toInput.removeAttribute('aria-invalid');
      }
    });
  }
})();