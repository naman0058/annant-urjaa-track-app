(function () {
  const root = document.querySelector('[data-folder-import]');
  if (!root) return;

  const table = document.getElementById('folderImportTable');
  const search = document.getElementById('folderImportSearch');
  const selLabel = document.getElementById('folderImportSelection');
  const drawer = document.getElementById('folderImportOptions');
  const form = document.getElementById('folderImportForm');

  const hiddenMap = {
    language: 'fiLanguage',
    audience: 'fiAudience',
    region: 'fiRegion',
    tone: 'fiTone',
    optional_category: 'fiCategory',
    default_author: 'fiAuthor',
    duplicate_hash: 'fiDupHash',
    duplicate_slug: 'fiDupSlug',
  };

  function openDrawer() {
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('folderImportOptions', true);
  }

  function closeDrawer() {
    if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('folderImportOptions', false);
  }

  root.querySelector('[data-folder-options-open]')?.addEventListener('click', openDrawer);
  drawer?.querySelectorAll('[data-folder-options-close]').forEach((el) => {
    el.addEventListener('click', closeDrawer);
  });

  drawer?.querySelector('[data-folder-options-apply]')?.addEventListener('click', () => {
    drawer.querySelectorAll('[data-fi-opt]').forEach((el) => {
      const key = el.getAttribute('data-fi-opt');
      const hid = hiddenMap[key];
      if (!hid) return;
      const target = document.getElementById(hid);
      if (target) target.value = el.value;
    });
    closeDrawer();
  });

  function updateSelectionCount() {
    if (!selLabel || !table) return;
    const checked = table.querySelectorAll('.folderImportCb:checked').length;
    const total = table.querySelectorAll('.folderImportCb').length;
    selLabel.textContent = total ? `${checked} of ${total} selected` : '';
  }

  function filterRows() {
    if (!table || !search) return;
    const q = search.value.trim().toLowerCase();
    table.querySelectorAll('[data-folder-file-row]').forEach((row) => {
      const hay = row.getAttribute('data-search') || '';
      row.hidden = q ? !hay.includes(q) : false;
    });
  }

  search?.addEventListener('input', filterRows);

  document.getElementById('folderImportSelectAll')?.addEventListener('click', () => {
    table?.querySelectorAll('.folderImportCb').forEach((cb) => {
      if (!cb.closest('tr')?.hidden) cb.checked = true;
    });
    updateSelectionCount();
  });

  document.getElementById('folderImportSelectNone')?.addEventListener('click', () => {
    table?.querySelectorAll('.folderImportCb').forEach((cb) => {
      cb.checked = false;
    });
    updateSelectionCount();
  });

  table?.addEventListener('change', (ev) => {
    if (ev.target && ev.target.classList.contains('folderImportCb')) updateSelectionCount();
  });

  updateSelectionCount();

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDrawer();
  });
})();