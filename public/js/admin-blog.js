(function () {
  const page = document.querySelector('[data-blog]');
  if (!page) return;

  window.AdminRowMenu?.bind(page, 'closeBlogRowMenus');

  const filtersForm = document.getElementById('blogFiltersForm');
  filtersForm?.addEventListener('submit', () => {
    const submitBtn = filtersForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
  });
})();