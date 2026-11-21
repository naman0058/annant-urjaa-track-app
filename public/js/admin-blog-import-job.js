(function () {
  const root = document.getElementById('jobMonitor');
  if (!root) return;
  const id = root.getAttribute('data-job-id');
  if (!id) return;

  const badge = document.getElementById('jobStatusBadge');
  const bar = document.getElementById('jobProgressBar');
  const progressText = document.getElementById('jobProgress');
  const tbody = document.getElementById('itemsTableBody');

  const statusClass = {
    completed: 'success',
    processing: 'warning',
    queued: 'info',
    pending: 'info',
    paused: 'warning',
    cancelled: 'danger',
    failed: 'danger',
    skipped: 'warning',
  };

  function badgeClass(s) {
    return statusClass[String(s).toLowerCase()] || 'info';
  }

  function setBadge(el, status) {
    if (!el) return;
    el.textContent = status;
    el.className = 'statusBadge statusBadge--' + badgeClass(status);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fileBaseName(path) {
    const p = String(path || '');
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(i + 1) : p;
  }

  function renderItems(items) {
    if (!tbody || !Array.isArray(items)) return;
    tbody.innerHTML = items
      .map((it) => {
        const path = it.relative_path || it.file_name || '';
        const note = it.error_message || it.skip_reason || '';
        const post = it.post_id ? `<a class="mono" href="/admin/blog/${it.post_id}/edit">#${it.post_id}</a>` : '—';
        const menu = [];
        if (it.post_id) {
          menu.push(`<li><a href="/admin/blog/${it.post_id}/edit">Open in CMS</a></li>`);
          menu.push(`<li><a href="/admin/blog/${it.post_id}/preview" target="_blank" rel="noopener">Preview draft</a></li>`);
          menu.push(`<li><a href="/admin/blogs/jobs/${id}/review">Compare</a></li>`);
        }
        const actions =
          menu.length > 0
            ? `<details class="rowMenu" data-row-menu>
            <summary class="btn btn--ghost btn--mini" aria-label="File actions">•••</summary>
            <div class="rowMenu__panel"><ul class="rowMenu__list">${menu.join('')}</ul></div>
          </details>`
            : '';
        return `<tr data-item-status="${escapeHtml(it.status)}">
          <td class="importStudio__fileName" title="${escapeHtml(path)}">${escapeHtml(fileBaseName(path))}</td>
          <td><span class="statusBadge statusBadge--${badgeClass(it.status)}">${escapeHtml(it.status)}</span></td>
          <td>${post}</td>
          <td class="cellMuted folderImportReason">${escapeHtml(note)}</td>
          <td class="col-actions">${actions}</td>
        </tr>`;
      })
      .join('');
  }

  function applyJobItemFilter() {
    const val = document.getElementById('importJobStatusFilter')?.value || 'all';
    tbody?.querySelectorAll('tr[data-item-status]').forEach((tr) => {
      const st = tr.getAttribute('data-item-status') || '';
      tr.hidden = val !== 'all' && st !== val;
    });
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importJobItemFilters', false);
  }

  document.getElementById('importJobFilterApply')?.addEventListener('click', applyJobItemFilter);

  function poll() {
    fetch('/admin/blogs/jobs/' + id + '/status.json', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.job) return;
        setBadge(badge, data.job.status);
        if (progressText) progressText.textContent = data.progress + '%';
        if (bar) bar.style.width = data.progress + '%';
        root.querySelector('#jobProgressBar')?.setAttribute('aria-valuenow', String(data.progress));
        const set = (sel, val) => {
          const el = document.querySelector(sel);
          if (el) el.textContent = val;
        };
        set('#stCompleted', data.job.completed_count);
        set('#stPending', data.job.pending_count);
        set('#stProcessing', data.job.processing_count);
        set('#stFailed', data.job.failed_count);
        if (data.job.actual_cost_usd != null) set('#stCost', data.job.actual_cost_usd);
        renderItems(data.items);
      })
      .catch(() => {});
  }

  setInterval(poll, 8000);

  const workerEnabled = root.dataset.workerEnabled !== '1';
  const csrf = root.dataset.csrf || '';
  let processInFlight = false;

  function tickProcess() {
    if (processInFlight) return;
    const badge = document.getElementById('jobStatusBadge');
    const st = badge?.textContent || '';
    if (!['queued', 'processing'].includes(String(st).toLowerCase())) return;
    processInFlight = true;
    const fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('job_id', id);
    fd.append('limit', '2');
    const body = new URLSearchParams(fd);
    fetch('/admin/blogs/import/process', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    })
      .then((r) => r.json())
      .then(() => poll())
      .catch(() => {})
      .finally(() => {
        processInFlight = false;
      });
  }

  if (workerEnabled) {
    setInterval(tickProcess, 15000);
    setTimeout(tickProcess, 3000);
  }
})();