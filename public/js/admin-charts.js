(function (global) {
  'use strict';

  const gridColor = 'rgba(166, 173, 184, 0.1)';
  const tickColor = '#a6adb8';

  function rupees(paise) {
    const n = Number(paise || 0) / 100;
    return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function formatLabel(iso, granularity) {
    if (!iso) return '';
    if (granularity === 'monthly' && /^\d{4}-\d{2}$/.test(iso)) {
      const [y, m] = iso.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', {
        month: 'short',
        year: '2-digit',
      });
    }
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    if (granularity === 'weekly') {
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function setChartEmpty(wrapId, canvasId, emptyId, isEmpty) {
    const wrap = wrapId ? document.getElementById(wrapId) : null;
    const canvas = document.getElementById(canvasId);
    const empty = emptyId ? document.getElementById(emptyId) : null;
    if (wrap) wrap.classList.toggle('panel__body--chart-empty', isEmpty);
    if (canvas) {
      canvas.hidden = isEmpty;
      canvas.style.display = isEmpty ? 'none' : 'block';
    }
    if (empty) empty.hidden = !isEmpty;
  }

  function baseOptions(yFmt, pointCount) {
    const showPoints = pointCount <= 24;
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1b2028',
          borderColor: '#303640',
          borderWidth: 1,
          titleColor: '#f4f5f7',
          bodyColor: '#a6adb8',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: {
            color: tickColor,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: pointCount > 60 ? 8 : 12,
          },
          grid: { color: gridColor, drawBorder: false },
        },
        y: {
          ticks: { color: tickColor, callback: (v) => yFmt(v) },
          grid: { color: gridColor, drawBorder: false },
          beginAtZero: true,
          border: { color: 'rgba(166,173,184,0.2)', width: 1 },
        },
      },
      elements: {
        line: { borderJoinStyle: 'round' },
        point: { radius: showPoints ? 2 : 0, hoverRadius: showPoints ? 4 : 3 },
      },
    };
  }

  function revenueChart(canvasId, wrapId, emptyId, series, granularity, kpiPaise) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const total = Number(kpiPaise || 0) || (series || []).reduce((s, r) => s + Number(r.y || 0), 0);
    if (total <= 0) {
      setChartEmpty(wrapId, canvasId, emptyId, true);
      return;
    }
    setChartEmpty(wrapId, canvasId, emptyId, false);
    const nonZero = (series || []).filter((r) => Number(r.y || 0) > 0).length;
    const useBars = nonZero > 0 && nonZero <= 6 && (series || []).length <= 31;
    new Chart(ctx, {
      type: useBars ? 'bar' : 'line',
      data: {
        labels: (series || []).map((d) => formatLabel(d.x, granularity)),
        datasets: [
          {
            data: (series || []).map((d) => Number(d.y || 0) / 100),
            borderColor: '#d7af45',
            backgroundColor: useBars ? 'rgba(215, 175, 69, 0.65)' : 'rgba(215, 175, 69, 0.1)',
            fill: !useBars,
            tension: 0.15,
            borderWidth: useBars ? 1 : 1.5,
            borderRadius: useBars ? 4 : 0,
          },
        ],
      },
      options: baseOptions((v) => '₹' + Number(v).toLocaleString('en-IN'), (series || []).length),
    });
  }

  function barChart(canvasId, wrapId, emptyId, series, granularity, color, kpiTotal) {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const sum = (series || []).reduce((s, r) => s + Number(r.y || 0), 0);
    const total = Number(kpiTotal ?? sum);
    if (total <= 0) {
      setChartEmpty(wrapId, canvasId, emptyId, true);
      return;
    }
    setChartEmpty(wrapId, canvasId, emptyId, false);
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: (series || []).map((d) => formatLabel(d.x, granularity)),
        datasets: [
          {
            data: (series || []).map((d) => Number(d.y || 0)),
            backgroundColor: color,
            borderColor: color.replace('0.5', '1').replace('0.55', '1'),
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 36,
          },
        ],
      },
      options: baseOptions((v) => v, (series || []).length),
    });
  }

  const statusColors = {
    captured: '#34c98a',
    failed: '#ec6a6a',
    refunded: '#e5ad45',
    created: '#74a9ef',
    authorized: '#74a9ef',
    in_transit: '#e5ad45',
  };

  function renderDonutLegend(legendEl, rows, total) {
    if (!legendEl) return;
    legendEl.innerHTML = '';
    legendEl.removeAttribute('aria-hidden');
    rows.forEach((r) => {
      const cnt = Number(r.cnt || 0);
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0';
      const color = statusColors[r.status] || '#a6adb8';
      const label = String(r.status).replace(/_/g, ' ');
      const row = document.createElement('div');
      row.className = 'donutLegend__row';
      row.innerHTML = `<span class="donutLegend__label"><span class="donutLegend__swatch" style="background:${color}"></span><span>${label}</span></span><span class="donutLegend__nums">${cnt} · ${pct}%</span>`;
      legendEl.appendChild(row);
    });
  }

  function statusChart(canvasId, wrapId, emptyId, breakdown, legendId) {
    if (typeof Chart === 'undefined') return null;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const legendEl = legendId ? document.getElementById(legendId) : null;
    const rows = breakdown || [];
    const total = rows.reduce((s, r) => s + Number(r.cnt || 0), 0);
    if (total <= 0) {
      setChartEmpty(wrapId, canvasId, emptyId, true);
      if (legendEl) {
        legendEl.innerHTML = '';
        legendEl.setAttribute('aria-hidden', 'true');
      }
      return null;
    }
    setChartEmpty(wrapId, canvasId, emptyId, false);
    renderDonutLegend(legendEl, rows, total);
    const centerPlugin = {
      id: 'donutCenterTotal',
      beforeDraw(chart) {
        const { width, height } = chart;
        const meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data.length) return;
        const ctx2 = chart.ctx;
        ctx2.save();
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        const cx = width / 2;
        const cy = height / 2;
        ctx2.fillStyle = '#f4f5f7';
        ctx2.font = '700 26px Inter, system-ui, sans-serif';
        ctx2.fillText(String(total), cx, cy - 8);
        ctx2.fillStyle = '#a6adb8';
        ctx2.font = '600 11px Inter, system-ui, sans-serif';
        ctx2.fillText(total === 1 ? 'Transaction' : 'Transactions', cx, cy + 14);
        ctx2.restore();
      },
    };
    return new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: rows.map((r) => String(r.status).replace(/_/g, ' ')),
        datasets: [
          {
            data: rows.map((r) => r.cnt),
            backgroundColor: rows.map((r) => statusColors[r.status] || '#a6adb8'),
            borderWidth: 1,
            borderColor: '#303640',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1b2028',
            borderColor: '#303640',
            borderWidth: 1,
            titleColor: '#f4f5f7',
            bodyColor: '#a6adb8',
            callbacks: {
              label(ctxItem) {
                const n = ctxItem.parsed || 0;
                const pct = total > 0 ? ((n / total) * 100).toFixed(1) : 0;
                return ` ${n} (${pct}%)`;
              },
            },
          },
        },
      },
      plugins: [centerPlugin],
    });
  }

  function horizontalBarChart(canvasId, wrapId, emptyId, tracks, opts) {
    if (typeof Chart === 'undefined') return null;
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const valueKey = (opts && opts.valueKey) || 'cnt';
    const scale = (opts && opts.scale) || 1;
    const rows = (tracks || []).slice(0, 5);
    const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0);
    if (total <= 0) {
      setChartEmpty(wrapId, canvasId, emptyId, true);
      return null;
    }
    setChartEmpty(wrapId, canvasId, emptyId, false);
    const tickFmt =
      opts && opts.tickFmt
        ? opts.tickFmt
        : (v) => (scale === 100 ? '₹' + Number(v).toLocaleString('en-IN') : v);
    const body = rows.map((r) => ({
      title: r.title || r.track_id,
      value: Number(r[valueKey] || 0) / scale,
    }));
    const barHeight = Math.min(220, Math.max(100, body.length * 44 + 24));
    const wrap = document.getElementById(wrapId);
    if (wrap) wrap.style.minHeight = `${barHeight}px`;
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: body.map((r) => r.title),
        datasets: [
          {
            data: body.map((r) => r.value),
            backgroundColor: 'rgba(116, 169, 239, 0.55)',
            borderColor: '#74a9ef',
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctxItem) {
                const raw = rows[ctxItem.dataIndex];
                const val = Number(raw && raw[valueKey]) || 0;
                if (scale === 100) return ` ${rupees(val)}`;
                return ` ${val}`;
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, ticks: { color: tickColor, callback: tickFmt }, grid: { color: gridColor } },
          y: { ticks: { color: tickColor, autoSkip: false }, grid: { display: false } },
        },
      },
    });
  }

  function resizeCharts(charts) {
    (charts || []).forEach((ch) => {
      if (ch && typeof ch.resize === 'function') ch.resize();
    });
  }

  global.AdminCharts = {
    revenueChart,
    barChart,
    statusChart,
    horizontalBarChart,
    resizeCharts,
    rupees,
    formatLabel,
    setChartEmpty,
  };
})(window);