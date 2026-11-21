(function () {
  const page = document.querySelector('[data-transactions]');
  if (!page) return;

  const form = document.getElementById('txFiltersForm');
  document.querySelectorAll('.txSearchPill[data-tx-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!form) return;
      const field = btn.getAttribute('data-tx-filter');
      const value = btn.getAttribute('data-tx-value') || '';
      const select = form.querySelector(`select[name="${field}"]`);
      if (select) select.value = value;
    });
  });

  window.AdminRowMenu?.bind(page, 'closeTransactionRowMenus');

  const filtersForm = document.getElementById('txFiltersForm');
  filtersForm?.addEventListener('submit', () => {
    const submitBtn = filtersForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
  });
})();