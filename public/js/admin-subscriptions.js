(function () {
  const page = document.querySelector('[data-subscriptions]');
  if (!page) return;

  page.querySelectorAll('form.subFormDrawer__form, #subCreateForm, #subEditForm').forEach((form) => {
    form.addEventListener('submit', (e) => {
      const status = form.querySelector('[name="status"]');
      const userId = form.querySelector('[name="user_id"]');
      const track = form.querySelector('[name="track"]');
      if (userId && !userId.value) {
        e.preventDefault();
        alert('Select a member from search results.');
        return;
      }
      if (track && !String(track.value).trim()) {
        e.preventDefault();
        alert('Select a valid track.');
        return;
      }
      const submitter = form.closest('.subFormDrawer')?.querySelector('[type="submit"]');
      if (submitter) {
        submitter.disabled = true;
        submitter.setAttribute('aria-busy', 'true');
      }
    });
  });

  async function fetchLookup(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.rows || [];
  }

  function setupLookup({ input, hidden, dropdown, buildUrl }) {
    if (!input || !dropdown) return;
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (hidden) hidden.value = '';
      if (q.length < 2) {
        dropdown.hidden = true;
        dropdown.innerHTML = '';
        return;
      }
      t = setTimeout(async () => {
        const rows = await fetchLookup(buildUrl(q));
        if (!rows.length) {
          dropdown.hidden = true;
          dropdown.innerHTML = '';
          return;
        }
        dropdown.innerHTML = rows
          .map((r) => {
            const label = r.email ? `${r.name || ''} · ${r.email}` : r.title || r.id;
            return `<button type="button" class="lookupDropdown__item" data-id="${r.id}" data-label="${String(label).replace(/"/g, '&quot;')}">${label}</button>`;
          })
          .join('');
        dropdown.hidden = false;
      }, 250);
    });
    dropdown.addEventListener('click', (e) => {
      const btn = e.target.closest('.lookupDropdown__item');
      if (!btn) return;
      if (hidden) hidden.value = btn.dataset.id;
      input.value = btn.dataset.label || btn.textContent;
      dropdown.hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== input) dropdown.hidden = true;
    });
  }

  setupLookup({
    input: document.getElementById('subCreateUserSearch'),
    hidden: document.getElementById('subCreateUserId'),
    dropdown: document.getElementById('subCreateUserResults'),
    buildUrl: (q) => `/admin/users/lookup?q=${encodeURIComponent(q)}`,
  });

  setupLookup({
    input: document.getElementById('subFilterUserSearch'),
    hidden: document.getElementById('subFilterUserId'),
    dropdown: document.getElementById('subFilterUserResults'),
    buildUrl: (q) => `/admin/users/lookup?q=${encodeURIComponent(q)}`,
  });

  setupLookup({
    input: document.getElementById('CreateTrackSearch'),
    hidden: document.getElementById('CreateTrackId'),
    dropdown: document.getElementById('CreateTrackResults'),
    buildUrl: (q) => `/admin/subscriptions/lookup/tracks?q=${encodeURIComponent(q)}`,
  });

  setupLookup({
    input: document.getElementById('EditTrackSearch'),
    hidden: document.getElementById('EditTrackId'),
    dropdown: document.getElementById('EditTrackResults'),
    buildUrl: (q) => `/admin/subscriptions/lookup/tracks?q=${encodeURIComponent(q)}`,
  });

  window.AdminRowMenu?.bind(page, 'closeSubscriptionRowMenus');

  function openEditDrawer(btn) {
    window.AdminRowMenu?.closeRowMenu(btn.closest('[data-row-menu]'));
    const editForm = document.getElementById('subEditForm');
    const id = btn.dataset.id;
    if (!editForm || !id) return;
    editForm.action = `/admin/subscriptions/${id}`;
    const redirect = document.querySelector('[data-sub-detail]') ? 'detail' : 'list';
    const redirInput = editForm.querySelector('input[name="_redirect"]');
    if (redirInput) redirInput.value = redirect;
    const trackSearch = document.getElementById('EditTrackSearch');
    const trackHidden = document.getElementById('EditTrackId');
    const trackText = document.getElementById('EditTrackText');
    if (trackHidden) {
      trackHidden.value = btn.dataset.track || '';
      if (trackSearch) trackSearch.value = btn.dataset.trackTitle || btn.dataset.track || '';
    } else if (trackText) {
      trackText.value = btn.dataset.track || '';
    }
    const status = document.getElementById('EditStatus');
    if (status) status.value = btn.dataset.status || 'expired';
    const start = document.getElementById('EditStart');
    const end = document.getElementById('EditEnd');
    if (start) start.value = btn.dataset.start || '';
    if (end) end.value = btn.dataset.end || '';
    const drawer = document.getElementById('subEditDrawer');
    if (drawer && typeof window.setDrawerOpen === 'function') {
      window.setDrawerOpen('subEditDrawer', true);
    } else if (drawer) {
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
    }
  }

  page.querySelectorAll('[data-sub-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openEditDrawer(btn));
  });
})();