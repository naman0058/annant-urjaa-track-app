(function () {
  const page = document.querySelector('[data-staff]');
  if (!page) return;

  const listReturn = document.getElementById('staffListReturnQs');

  function syncListReturn() {
    const val = listReturn ? listReturn.value : '';
    ['staffCreateListReturn', 'staffEditListReturn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
  }

  syncListReturn();

  page.querySelectorAll('#staffCreateForm, #staffEditForm').forEach((form) => {
    form.addEventListener('submit', () => {
      syncListReturn();
      const submitter = form.closest('.staffFormDrawer')?.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
        submitter.setAttribute('aria-busy', 'true');
      }
    });
  });

  window.AdminRowMenu?.bind(page, 'closeStaffRowMenus');

  function openEditDrawer(btn) {
    window.AdminRowMenu?.closeRowMenu(btn.closest('[data-row-menu]'));
    const form = document.getElementById('staffEditForm');
    const id = btn.dataset.id;
    if (!form || !id) return;
    form.action = `/admin/staff/${id}`;
    const name = document.getElementById('staffEditName');
    const email = document.getElementById('staffEditEmailDisplay');
    const pass = document.getElementById('staffEditPassword');
    const role = document.getElementById('staffEditRole');
    const active = document.getElementById('staffEditActive');
    if (name) name.value = btn.dataset.name || '';
    if (email) email.value = btn.dataset.email || '';
    if (pass) pass.value = '';
    if (role) role.value = btn.dataset.role || 'manager';
    if (active) active.checked = btn.dataset.active === '1';
    const redirect = document.getElementById('staffEditRedirect');
    if (redirect) redirect.value = page.hasAttribute('data-staff-detail') ? 'detail' : 'list';
    syncListReturn();
    if (typeof window.setDrawerOpen === 'function') {
      window.setDrawerOpen('staffEditDrawer', true);
    }
  }

  page.querySelectorAll('[data-staff-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDrawer(btn));
  });
})();