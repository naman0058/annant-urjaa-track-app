(function () {
  const root = document.querySelector('[data-import-studio][data-folder-import]');
  if (!root) return;

  const csrf = root.dataset.csrf || document.querySelector('[name="_csrf"]')?.value || '';

  /** FormData defaults to multipart; Express only parses urlencoded/json unless multer is used. */
  function importPostOptions(formData) {
    const body = new URLSearchParams(formData);
    if (csrf && !body.has('_csrf')) body.set('_csrf', csrf);
    return {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    };
  }
  let scanId = root.dataset.scanId || sessionStorage.getItem('importScanId') || '';
  let step = parseInt(sessionStorage.getItem('importStudioStep') || '1', 10);
  const selected = new Set(JSON.parse(sessionStorage.getItem('importSelected') || '[]'));
  let estimate = null;
  let listPage = 1;
  let allEligiblePaths = [];

  const STEP_HINTS = [
    'Scan the configured folder for supported documents.',
    'Choose files to import. Use Filters to search or bulk-select.',
    'Review AI settings before estimating cost.',
    'Verify token usage and estimated API cost.',
    'Authorize the job to start background processing.',
  ];

  const stepsEl = document.getElementById('importStudioSteps');
  const panels = root.querySelectorAll('[data-step-panel]');
  const footCount = document.getElementById('importFootCount');
  const btnBack = document.getElementById('importStepBack');
  const btnNext = document.getElementById('importStepNext');
  const tbody = document.getElementById('importFileTableBody');

  function syncFilterDrawerFromState() {
    const q = document.getElementById('importFileSearch')?.value || '';
    const status = document.getElementById('importStatusFilter')?.value || 'all';
    const qIn = document.getElementById('importFilterSearch');
    const sIn = document.getElementById('importFilterStatus');
    if (qIn) qIn.value = q;
    if (sIn) sIn.value = status;
  }

  function updateFilterCount() {
    const q = document.getElementById('importFileSearch')?.value?.trim() || '';
    const status = document.getElementById('importStatusFilter')?.value || 'all';
    const n = (q ? 1 : 0) + (status !== 'all' ? 1 : 0);
    const badge = document.getElementById('importFileFilterCount');
    const btn = document.getElementById('importHeaderFileFilters');
    if (badge) {
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = String(n);
      } else badge.hidden = true;
    }
    if (btn) btn.classList.toggle('has-active-filters', n > 0);
  }

  function updateHeaderActions() {
    const fileBtn = document.getElementById('importHeaderFileFilters');
    const aiBtn = document.getElementById('importHeaderAi');
    const onStudio = Boolean(scanId);
    if (fileBtn) fileBtn.hidden = !onStudio || step < 2;
    if (aiBtn) aiBtn.hidden = !onStudio || step < 3;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateRailSteps() {
    document.querySelectorAll('.importStudio__railStep').forEach((el) => {
      const s = parseInt(el.dataset.railStep, 10);
      el.classList.toggle('is-active', s === step);
      el.classList.toggle('is-done', s < step);
    });
  }

  function setRailSource(label, meta) {
    const card = document.getElementById('importRailSourceCard');
    if (card) card.hidden = !label;
    setText('importRailSource', label || '—');
    const metaEl = document.getElementById('importRailSourceMeta');
    if (metaEl) metaEl.textContent = meta || '';
  }

  const FOOT_HINTS = [
    'Choose a source folder (e.g. 1 or 2), then scan. Default folder comes from BLOG_IMPORT_DIR.',
    'Row menu (•••) opens extraction preview.',
    'Adjust publish behavior under AI settings.',
    'Estimates depend on file content length.',
    'Job runs in the background — track it under Import history.',
  ];

  function updateStepChrome() {
    const hint = document.getElementById('importStudioStepHint');
    if (hint) hint.textContent = STEP_HINTS[step - 1] || '';
    const sub = document.getElementById('importHeaderSubtitle');
    if (sub) {
      sub.textContent = scanId
        ? `${selected.size} file${selected.size === 1 ? '' : 's'} in queue · OpenAI-powered import`
        : 'Scan documents, configure AI, and queue a background import job.';
    }
    const badge = document.getElementById('importStepBadge');
    if (badge) {
      badge.hidden = false;
      badge.textContent = `Step ${step} of 5`;
    }
    const footHint = document.getElementById('importFootHint');
    if (footHint) footHint.textContent = FOOT_HINTS[step - 1] || '';
    updateRailSteps();
  }

  function updateAiSummary() {
    const mode = document.getElementById('importMode');
    const modeLabel = mode?.selectedOptions?.[0]?.textContent?.trim() || mode?.value || '—';
    const lang = document.getElementById('importLanguage')?.value?.trim() || '—';
    const tone = document.getElementById('importTone')?.value?.trim() || '—';
    const model = document.getElementById('importModel')?.value || '—';
    const pub = document.getElementById('importAutoPublish')?.checked;
    setText('importAiMode', modeLabel);
    setText('importAiLang', lang);
    setText('importAiTone', tone);
    setText('importAiModel', model);
    setText('importAiPublish', pub ? 'Publish on site' : 'Review only');
    const note = document.getElementById('importConfirmPublishNote');
    if (note) {
      note.textContent = pub
        ? 'Posts publish to the live blog after processing. OpenAI usage is billed to your API account; duplicates are skipped by hash.'
        : 'Posts stay in review until you publish manually. OpenAI usage is billed to your API account; duplicates are skipped by hash.';
    }
  }

  function setStep(n) {
    step = Math.min(5, Math.max(1, n));
    sessionStorage.setItem('importStudioStep', String(step));
    updateHeaderActions();
    stepsEl?.querySelectorAll('.importStudio__step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('is-active', s === step);
      el.classList.toggle('is-done', s < step);
      if (s === step) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
    });
    panels.forEach((p) => {
      p.hidden = parseInt(p.dataset.stepPanel, 10) !== step;
    });
    btnBack.disabled = step <= 1;
    btnNext.textContent = step === 5 ? 'Start import' : 'Continue';
    btnNext.disabled = step === 2 && selected.size === 0;
    btnNext?.classList.toggle('is-cta', step === 5);
    btnNext?.classList.toggle('btn--mini', step !== 5);
    updateStepChrome();
    if (step === 4) loadEstimate();
    if (step === 3) updateAiSummary();
    if (step === 5) renderConfirm();
  }

  function updateCounts() {
    const n = selected.size;
    if (footCount) footCount.textContent = `${n} document${n === 1 ? '' : 's'} selected`;
    const kpi = document.getElementById('kpiSelected');
    if (kpi) kpi.textContent = String(n);
    btnNext.disabled = step === 2 && n === 0;
    sessionStorage.setItem('importSelected', JSON.stringify([...selected]));
    updateStepChrome();
  }

  function fmtKb(n) {
    return n ? `${(n / 1024).toFixed(1)} KB` : '—';
  }

  function badgeClass(status) {
    const map = {
      supported: 'success',
      skipped: 'warning',
      unsupported: 'danger',
      already_imported: 'info',
    };
    return map[status] || 'info';
  }

  async function loadEntries(page = 1) {
    if (!scanId) return;
    listPage = page;
    const q = document.getElementById('importFileSearch')?.value || '';
    const status = document.getElementById('importStatusFilter')?.value || 'all';
    const url = `/admin/blogs/import/scan/${encodeURIComponent(scanId)}/entries?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&page=${page}&limit=50`;
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    if (!tbody) return;
    const rows = data.rows || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="importStudio__emptyCell">
        <div class="dashEmpty" role="status"><p class="dashEmpty__label">No files match these filters.</p></div></td></tr>`;
      const pager = document.getElementById('importPager');
      if (pager) pager.innerHTML = '';
      updateFilterCount();
      return;
    }
    tbody.innerHTML = rows
      .map((row) => {
        const canSelect = row.status === 'supported' && !row.alreadyImported;
        const checked = selected.has(row.relativePath);
        const name = row.fileName || row.relativePath;
        const st = row.displayStatus || row.status;
        return `<tr data-path="${escapeHtml(row.relativePath)}">
          <td class="col-check">${canSelect ? `<input type="checkbox" class="importFileCb" data-path="${escapeHtml(row.relativePath)}" ${checked ? 'checked' : ''}>` : ''}</td>
          <td class="importStudio__fileName" title="${escapeHtml(row.relativePath)}">${escapeHtml(name)}</td>
          <td class="mono">${escapeHtml(row.ext || '—')}</td>
          <td class="mono col-numeric">${fmtKb(row.size)}</td>
          <td><span class="statusBadge statusBadge--${badgeClass(st)}">${escapeHtml(st)}</span>${row.reason ? `<span class="cellMuted folderImportReason">${escapeHtml(row.reason)}</span>` : ''}</td>
          <td class="col-actions">${
            row.status === 'supported'
              ? `<details class="rowMenu" data-row-menu>
              <summary class="btn btn--ghost btn--mini" aria-label="File actions">•••</summary>
              <div class="rowMenu__panel">
                <ul class="rowMenu__list">
                  <li><button type="button" class="rowMenu__btn" data-preview-path="${escapeHtml(row.relativePath)}">Preview extract</button></li>
                </ul>
              </div>
            </details>`
              : ''
          }</td>
        </tr>`;
      })
      .join('');

    const pager = document.getElementById('importPager');
    if (pager && data.pagination) {
      const { page: p, total, limit } = data.pagination;
      const pages = Math.max(1, Math.ceil(total / limit));
      const prevDisabled = p <= 1;
      const nextDisabled = p >= pages;
      pager.innerHTML = `
        <span class="reportTxPager__info">${p} / ${pages} · ${total} files</span>
        <div class="reportTxPager__nav">
          <button type="button" class="btn btn--ghost btn--mini" data-import-page="${p - 1}" ${prevDisabled ? 'disabled' : ''}>Prev</button>
          <button type="button" class="btn btn--ghost btn--mini" data-import-page="${p + 1}" ${nextDisabled ? 'disabled' : ''}>Next</button>
        </div>`;
      pager.querySelectorAll('[data-import-page]').forEach((b) => {
        b.addEventListener('click', () => {
          const pg = parseInt(b.dataset.importPage, 10);
          if (!Number.isNaN(pg) && pg >= 1) loadEntries(pg);
        });
      });
    }
    updateFilterCount();

    tbody.querySelectorAll('.importFileCb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const path = cb.dataset.path;
        if (cb.checked) selected.add(path);
        else selected.delete(path);
        updateCounts();
      });
    });
    tbody.querySelectorAll('[data-preview-path]').forEach((btn) => {
      btn.addEventListener('click', () => openPreview(btn.dataset.previewPath));
    });
  }

  async function loadAllEligiblePaths() {
    if (!scanId) return [];
    const url = `/admin/blogs/import/scan/${encodeURIComponent(scanId)}/entries?status=supported&alreadyImported=0&page=1&limit=5000`;
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    return (data.rows || []).filter((r) => !r.alreadyImported).map((r) => r.relativePath);
  }

  async function pruneSelectionToEligible() {
    const eligible = new Set(await loadAllEligiblePaths());
    allEligiblePaths = [...eligible];
    for (const p of [...selected]) {
      if (!eligible.has(p)) selected.delete(p);
    }
    sessionStorage.setItem('importSelected', JSON.stringify([...selected]));
    updateCounts();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function runScan(ev) {
    ev.preventDefault();
    const form = document.getElementById('importScanForm');
    const fd = new FormData(form);
    const status = document.getElementById('importScanStatus');
    if (status) status.textContent = 'Scanning…';
    const res = await fetch('/admin/blogs/import/scan', importPostOptions(fd));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) status.textContent = data.error || 'Scan failed';
      return;
    }
    scanId = data.scanId;
    root.dataset.scanId = scanId;
    sessionStorage.setItem('importScanId', scanId);
    sessionStorage.removeItem('importSelected');
    selected.clear();
    allEligiblePaths = await loadAllEligiblePaths();
    allEligiblePaths.forEach((p) => selected.add(p));
    document.getElementById('importSummaryKpis')?.removeAttribute('hidden');
    const ready =
      data.summary?.eligible ??
      Math.max(0, (data.summary?.supported ?? 0) - (data.summary?.alreadyImported ?? 0));
    document.getElementById('kpiSupported').textContent = String(ready);
    document.getElementById('kpiSkipped').textContent = data.summary?.skipped ?? 0;
    document.getElementById('kpiImported').textContent = data.summary?.alreadyImported ?? 0;
    if (status) status.textContent = `Scanned ${data.configuredLabel || 'source'}.`;
    setRailSource(data.configuredLabel || 'Import source', `${data.summary?.supported ?? 0} supported · ${data.summary?.skipped ?? 0} skipped`);
    updateCounts();
    await loadEntries(1);
    setStep(2);
  }

  async function loadEstimate() {
    const pending = document.getElementById('importEstimatePending');
    const metrics = document.getElementById('importEstimateMetrics');
    const note = document.getElementById('importEstimateNote');
    if (!scanId || !selected.size) {
      if (pending) {
        pending.hidden = false;
        pending.textContent = 'Select at least one document to estimate cost.';
      }
      if (metrics) metrics.hidden = true;
      return;
    }
    if (pending) {
      pending.hidden = false;
      pending.textContent = 'Calculating estimate…';
    }
    if (metrics) metrics.hidden = true;
    const fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('scanId', scanId);
    [...selected].forEach((p) => fd.append('files', p));
    const res = await fetch('/admin/blogs/import/estimate', importPostOptions(fd));
    const data = await res.json();
    if (!res.ok) {
      if (pending) {
        pending.hidden = false;
        pending.textContent = data.error || 'Estimate failed';
      }
      return;
    }
    estimate = data.estimate;
    if (pending) pending.hidden = true;
    if (metrics) metrics.hidden = false;
    setText('estFiles', String(estimate.fileCount ?? selected.size));
    setText('estIn', (estimate.inputTokens ?? 0).toLocaleString());
    setText('estOut', (estimate.outputTokens ?? 0).toLocaleString());
    setText('estCost', `$${estimate.estimatedCostUsd}`);
    if (note) {
      const extra = [estimate.estimateQuality, estimate.assumptions].filter(Boolean).join(' · ');
      note.textContent = extra;
      note.hidden = !extra;
    }
    if (step === 5) renderConfirm();
  }

  function configPayload() {
    return {
      language: document.getElementById('importLanguage')?.value,
      tone: document.getElementById('importTone')?.value,
      audience: document.getElementById('importAudience')?.value,
      region: document.getElementById('importRegion')?.value,
      optional_category: document.getElementById('importCategory')?.value,
      default_author: document.getElementById('importAuthor')?.value,
      import_mode: document.getElementById('importMode')?.value,
      model: document.getElementById('importModel')?.value,
      auto_publish: document.getElementById('importAutoPublish')?.checked ? '1' : '0',
    };
  }

  function renderConfirm() {
    setText('confirmFiles', String(selected.size));
    setText('confirmModel', document.getElementById('importModel')?.value || '—');
    setText('confirmCost', estimate?.estimatedCostUsd != null ? `$${estimate.estimatedCostUsd}` : '—');
    updateAiSummary();
  }

  async function startJob() {
    if (!document.getElementById('importConfirmCost')?.checked) {
      window.alert('Confirm the cost authorization checkbox first.');
      return;
    }
    const fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('scanId', scanId);
    fd.append('confirm_cost', '1');
    fd.append('client_request_id', `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    [...selected].forEach((p) => fd.append('files', p));
    const cfg = configPayload();
    Object.entries(cfg).forEach(([k, v]) => fd.append(k, v || ''));
    const res = await fetch('/admin/blogs/import/start', importPostOptions(fd));
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || 'Could not start job');
      return;
    }
    sessionStorage.removeItem('importStudioStep');
    window.location.href = `/admin/blogs/jobs/${data.jobId}`;
  }

  async function openPreview(path) {
    const drawer = document.getElementById('importPreviewDrawer');
    const res = await fetch(
      `/admin/blogs/import/preview.json?path=${encodeURIComponent(path)}&scanId=${encodeURIComponent(scanId)}`,
      {
      credentials: 'same-origin',
    });
    const data = await res.json();
    document.getElementById('importPreviewTitle').textContent = data.fileName || 'Preview';
    document.getElementById('importPreviewMeta').innerHTML = `
      <span class="mono">${escapeHtml(data.ext || '')}</span> · ${fmtKb(data.size)}
      · <span class="statusBadge statusBadge--${data.extractionStatus === 'ok' ? 'success' : 'warning'}">${escapeHtml(data.extractionStatus || '')}</span>
    `;
    const body = document.getElementById('importPreviewBody');
    if (data.content_html) {
      body.innerHTML = data.content_html;
    } else {
      body.textContent = data.plain || data.error || 'No preview';
    }
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importPreviewDrawer', true);
    else drawer?.classList.add('is-open');
  }

  function selectPage() {
    tbody?.querySelectorAll('.importFileCb').forEach((cb) => {
      cb.checked = true;
      selected.add(cb.dataset.path);
    });
    updateCounts();
  }

  async function selectAllEligible() {
    if (!window.confirm('Select all eligible files in this scan (not only this page)?')) return;
    allEligiblePaths = await loadAllEligiblePaths();
    allEligiblePaths.forEach((p) => selected.add(p));
    await loadEntries(listPage);
    updateCounts();
  }

  function selectNone() {
    selected.clear();
    loadEntries(listPage);
    updateCounts();
  }

  document.getElementById('importScanForm')?.addEventListener('submit', runScan);
  document.getElementById('importRunEstimate')?.addEventListener('click', loadEstimate);

  document.getElementById('importFileFiltersApply')?.addEventListener('click', () => {
    const q = document.getElementById('importFilterSearch')?.value || '';
    const status = document.getElementById('importFilterStatus')?.value || 'all';
    const qH = document.getElementById('importFileSearch');
    const sH = document.getElementById('importStatusFilter');
    if (qH) qH.value = q;
    if (sH) sH.value = status;
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importFileFilters', false);
    loadEntries(1);
  });

  document.getElementById('importAiDrawerApply')?.addEventListener('click', () => {
    updateAiSummary();
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importAiDrawer', false);
  });
  document.getElementById('importAutoPublish')?.addEventListener('change', updateAiSummary);

  document.querySelectorAll('[data-filter-open="importFileFilters"]').forEach((btn) => {
    btn.addEventListener('click', syncFilterDrawerFromState);
  });

  document.getElementById('importSelectPageDrawer')?.addEventListener('click', selectPage);
  document.getElementById('importSelectAllDrawer')?.addEventListener('click', selectAllEligible);
  document.getElementById('importSelectNoneDrawer')?.addEventListener('click', selectNone);

  btnBack?.addEventListener('click', () => setStep(step - 1));
  btnNext?.addEventListener('click', () => {
    if (step === 5) startJob();
    else if (step === 4) setStep(5);
    else if (step === 3) {
      setStep(4);
      loadEstimate();
    } else setStep(step + 1);
  });

  document.querySelectorAll('[data-preview-close]').forEach((el) => {
    el.addEventListener('click', () => {
      if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importPreviewDrawer', false);
    });
  });

  document.getElementById('importRootSelect')?.addEventListener('change', () => {
    const status = document.getElementById('importScanStatus');
    if (status) status.textContent = 'Source folder changed — click Scan folder to load files from this folder.';
  });

  if (root.dataset.sourceLabel) {
    setRailSource(root.dataset.sourceLabel, root.dataset.sourceMeta || '');
  }

  if (scanId) {
    loadAllEligiblePaths().then(async (paths) => {
      allEligiblePaths = paths;
      await pruneSelectionToEligible();
      if (!selected.size) paths.forEach((p) => selected.add(p));
      updateCounts();
      const kpi = document.getElementById('kpiSupported');
      if (kpi && paths.length) kpi.textContent = String(paths.length);
      loadEntries(1);
      if (summaryVisible()) setStep(step > 1 ? step : 2);
    });
  } else setStep(1);

  function summaryVisible() {
    return !document.getElementById('importSummaryKpis')?.hasAttribute('hidden');
  }

  updateCounts();
  updateHeaderActions();
  updateAiSummary();
  updateStepChrome();
})();