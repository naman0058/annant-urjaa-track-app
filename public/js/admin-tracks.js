(function () {
  const page = document.querySelector('[data-tracks]');
  if (!page) return;

  const csrf = page.getAttribute('data-csrf') || '';

  window.AdminRowMenu?.bind(page, 'closeTrackRowMenus');

  const filtersForm = document.getElementById('trackFiltersForm');
  filtersForm?.addEventListener('submit', () => {
    const submitBtn = filtersForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
  });

  ['trackCreateForm', 'trackEditForm'].forEach((id) => {
    const form = document.getElementById(id);
    form?.addEventListener('submit', () => {
      const submitter = document.querySelector(`[form="${id}"][type="submit"]`);
      if (submitter) {
        submitter.disabled = true;
        submitter.setAttribute('aria-busy', 'true');
      }
    });
  });

  function openEditDrawer(btn) {
    window.AdminRowMenu?.closeRowMenu(btn.closest('[data-row-menu]'));
    const form = document.getElementById('trackEditForm');
    const drawer = document.getElementById('trackEditDrawer');
    const id = btn.getAttribute('data-id');
    if (!form || !drawer || !id) return;

    form.action = `/admin/tracks/${id}`;

    const set = (elId, val) => {
      const el = document.getElementById(elId);
      if (el) el.value = val != null ? String(val) : '';
    };

    set('trackEditCategory', btn.getAttribute('data-category-id'));
    set('trackEditTitle', btn.getAttribute('data-title'));
    set('trackEditDescription', btn.getAttribute('data-description'));
    set('trackEditPrice', btn.getAttribute('data-price-inr'));
    set('trackEditStatus', btn.getAttribute('data-status') || 'active');

    const ret = document.getElementById('trackEditReturn');
    const returnVal = btn.getAttribute('data-return') || '';
    if (ret) {
      if (returnVal === 'detail') ret.value = 'detail';
      else if (returnVal) ret.value = returnVal;
    }

    const thumb = btn.getAttribute('data-thumb') || '';
    const thumbImg = document.getElementById('trackEditThumbPreview');
    if (thumbImg) {
      if (thumb) {
        thumbImg.src = thumb;
        thumbImg.hidden = false;
      } else {
        thumbImg.removeAttribute('src');
        thumbImg.hidden = true;
      }
    }

    const hint = document.getElementById('trackEditMediaHint');
    if (hint) {
      hint.textContent =
        btn.getAttribute('data-has-mp3') === '1'
          ? 'Audio file is on file — upload only to replace.'
          : 'No MP3 on file yet — upload one below.';
    }

    if (typeof window.setDrawerOpen === 'function') {
      window.setDrawerOpen('trackEditDrawer', true);
    } else {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
    }
  }

  document.querySelectorAll('[data-track-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDrawer(btn));
  });

  const reorderList = document.getElementById('trackReorderList');
  const saveOrderBtn = document.getElementById('trackReorderSave');

  if (window.Sortable && reorderList) {
    new Sortable(reorderList, {
      draggable: '.trackReorderItem',
      handle: '.trackReorderHandle',
      animation: 160,
      forceFallback: true,
      delay: 120,
      delayOnTouchOnly: true,
    });
  }

  saveOrderBtn?.addEventListener('click', async () => {
    if (!reorderList) return;
    const categoryId = Number(reorderList.getAttribute('data-category-id') || 0);
    if (!categoryId) return;

    const items = Array.from(reorderList.querySelectorAll('.trackReorderItem'));
    const order = items.map((el, idx) => ({
      id: Number(el.getAttribute('data-id')),
      sort_order: idx + 1,
    }));

    try {
      saveOrderBtn.disabled = true;
      saveOrderBtn.textContent = 'Saving…';

      const resp = await fetch('/admin/tracks/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrf,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ category_id: categoryId, order, _csrf: csrf }),
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