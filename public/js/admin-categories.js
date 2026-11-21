(function () {
  const page = document.querySelector('[data-categories]');
  if (!page) return;

  const csrf = page.getAttribute('data-csrf') || '';

  const filtersForm = document.getElementById('catFiltersForm');
  filtersForm?.addEventListener('submit', () => {
    const submitBtn = filtersForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
  });

  const createForm = document.getElementById('catCreateForm');
  createForm?.addEventListener('submit', () => {
    const submitter = document.querySelector('[form="catCreateForm"][type="submit"]');
    if (submitter) {
      submitter.disabled = true;
      submitter.setAttribute('aria-busy', 'true');
    }
  });

  const editForm = document.getElementById('catEditForm');
  editForm?.addEventListener('submit', () => {
    const submitter = document.querySelector('[form="catEditForm"][type="submit"]');
    if (submitter) {
      submitter.disabled = true;
      submitter.setAttribute('aria-busy', 'true');
    }
  });

  function openEditDrawer(btn) {
    window.AdminRowMenu?.closeRowMenu(btn.closest('[data-row-menu]'));
    const form = document.getElementById('catEditForm');
    const drawer = document.getElementById('catEditDrawer');
    const id = btn.getAttribute('data-id');
    if (!form || !drawer || !id) return;

    form.action = `/admin/categories/${id}`;
    const name = document.getElementById('catEditName');
    const desc = document.getElementById('catEditDescription');
    const ret = document.getElementById('catEditReturn');
    const thumbWrap = document.getElementById('catEditThumbPreviewWrap');
    const thumbImg = document.getElementById('catEditThumbPreview');

    if (name) name.value = btn.getAttribute('data-name') || '';
    if (desc) desc.value = btn.getAttribute('data-description') || '';
    const returnVal = btn.getAttribute('data-return') || '';
    if (ret) {
      if (returnVal === 'detail') ret.value = 'detail';
      else if (returnVal) ret.value = returnVal;
    }

    const thumb = btn.getAttribute('data-thumb') || '';
    if (thumbWrap && thumbImg) {
      if (thumb) {
        thumbImg.src = thumb;
        thumbWrap.hidden = false;
      } else {
        thumbImg.removeAttribute('src');
        thumbWrap.hidden = true;
      }
    }

    if (typeof window.setDrawerOpen === 'function') {
      window.setDrawerOpen('catEditDrawer', true);
    } else {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
    }
  }

  document.querySelectorAll('[data-cat-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDrawer(btn));
  });

  window.AdminRowMenu?.bind(page, 'closeCategoryRowMenus');

  const reorderList = document.getElementById('catReorderList');
  const saveOrderBtn = document.getElementById('catReorderSave');

  if (window.Sortable && reorderList) {
    new Sortable(reorderList, {
      draggable: '.catReorderItem',
      handle: '.catReorderHandle',
      animation: 160,
      forceFallback: true,
      delay: 120,
      delayOnTouchOnly: true,
    });
  }

  saveOrderBtn?.addEventListener('click', async () => {
    if (!reorderList) return;
    const items = Array.from(reorderList.querySelectorAll('.catReorderItem'));
    const order = items.map((el, idx) => ({
      id: Number(el.getAttribute('data-id')),
      sort_order: idx + 1,
    }));

    try {
      saveOrderBtn.disabled = true;
      saveOrderBtn.textContent = 'Saving…';

      const resp = await fetch('/admin/categories/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrf,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ order, _csrf: csrf }),
      });

      const raw = await resp.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }

      if (!resp.ok) throw new Error(data.error || 'Failed to save order');

      window.location.reload();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to save order');
      saveOrderBtn.disabled = false;
      saveOrderBtn.textContent = 'Save order';
    }
  });
})();