(function () {
  const page = document.querySelector('[data-users]');
  if (!page) return;

  const listReturn = document.getElementById('userListReturnQs');

  function syncListReturn() {
    const val = listReturn ? listReturn.value : '';
    ['userCreateListReturn', 'userEditListReturn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
  }

  syncListReturn();

  page.querySelectorAll('#userCreateForm, #userEditForm').forEach((form) => {
    form.addEventListener('submit', () => {
      syncListReturn();
      const submitter = form.closest('.userFormDrawer')?.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
        submitter.setAttribute('aria-busy', 'true');
      }
    });
  });

  window.AdminRowMenu?.bind(page, 'closeUsersRowMenus');

  function openEditDrawer(btn) {
    window.AdminRowMenu?.closeRowMenu(btn.closest('[data-row-menu]'));
    const form = document.getElementById('userEditForm');
    const id = btn.dataset.id;
    if (!form || !id) return;
    form.action = `/admin/users/${id}`;
    const name = document.getElementById('userEditName');
    const email = document.getElementById('userEditEmail');
    const pass = document.getElementById('userEditPassword');
    if (name) name.value = btn.dataset.name || '';
    if (email) email.value = btn.dataset.email || '';
    if (pass) pass.value = '';
    const redirect = document.getElementById('userEditRedirect');
    if (redirect) redirect.value = page.hasAttribute('data-user-detail') ? 'detail' : 'list';
    syncListReturn();
    if (typeof window.setDrawerOpen === 'function') {
      window.setDrawerOpen('userEditDrawer', true);
    }
  }

  page.querySelectorAll('[data-user-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDrawer(btn));
  });
})();