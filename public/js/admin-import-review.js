(function () {
  const root = document.querySelector('[data-import-review]');
  if (!root) return;
  const jobId = root.dataset.jobId;

  document.querySelectorAll('[data-compare-item]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const itemId = btn.getAttribute('data-compare-item');
      const res = await fetch(`/admin/blogs/jobs/${jobId}/items/${itemId}/compare.json`, {
        credentials: 'same-origin',
      });
      const data = await res.json();
      document.getElementById('compareSource').textContent = data.sourcePlain || '';
      document.getElementById('compareGenerated').innerHTML = data.generatedHtml || '';
      if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importCompareDrawer', true);
    });
  });

  document.querySelectorAll('[data-compare-close]').forEach((el) => {
    el.addEventListener('click', () => {
      if (typeof window.setDrawerOpen === 'function') window.setDrawerOpen('importCompareDrawer', false);
    });
  });
})();