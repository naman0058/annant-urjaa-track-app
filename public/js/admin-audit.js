(function () {
  const root = document.querySelector('[data-audit]');
  if (!root) return;

  const drawer = document.getElementById('auditDetailDrawer');

  function openDetail(data) {
    document.getElementById('auditDetailWhen').textContent = data.when || '—';
    document.getElementById('auditDetailActor').textContent = data.actor || '—';
    document.getElementById('auditDetailAction').textContent = data.action || '—';
    document.getElementById('auditDetailEntity').textContent = data.entity || '—';
    const metaEl = document.getElementById('auditDetailMeta');
    try {
      metaEl.textContent = data.metadata ? decodeURIComponent(data.metadata) : '—';
    } catch {
      metaEl.textContent = data.metadata || '—';
    }
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('auditDetailDrawer', true);
    else drawer?.classList.add('is-open');
  }

  function closeDetail() {
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('auditDetailDrawer', false);
    else drawer?.classList.remove('is-open');
  }

  root.querySelectorAll('[data-audit-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDetail({
        when: btn.dataset.when,
        actor: btn.dataset.actor,
        action: btn.dataset.action,
        entity: btn.dataset.entity,
        metadata: btn.dataset.metadata,
      });
      btn.closest('details[data-row-menu]')?.removeAttribute('open');
    });
  });

  root.querySelectorAll('[data-audit-detail-close]').forEach((el) => {
    el.addEventListener('click', closeDetail);
  });
})();