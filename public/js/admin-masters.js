(function () {
  const page = document.querySelector('[data-masters]');
  if (!page) return;

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
    input: document.getElementById('masterCreateUserSearch'),
    hidden: document.getElementById('masterCreateUserId'),
    dropdown: document.getElementById('masterCreateUserResults'),
    buildUrl: (q) => `/admin/users/lookup?q=${encodeURIComponent(q)}`,
  });

  const createForm = document.getElementById('masterCreateForm');
  createForm?.addEventListener('submit', (e) => {
    const userId = createForm.querySelector('[name="assigned_member"]');
    if (userId && !String(userId.value).trim()) {
      e.preventDefault();
      alert('Select a master member from search results.');
      return;
    }
    const submitter = document.querySelector('[form="masterCreateForm"][type="submit"]');
    if (submitter) {
      submitter.disabled = true;
      submitter.setAttribute('aria-busy', 'true');
    }
  });

  const filtersForm = document.getElementById('masterFiltersForm');
  filtersForm?.addEventListener('submit', () => {
    const submitBtn = filtersForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }
  });

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  document.querySelectorAll('[data-copy-code]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.getAttribute('data-copy-code') || '';
      const ok = await copyText(code);
      if (ok) {
        const prev = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      }
    });
  });

  window.AdminRowMenu?.bind(page, 'closeMasterRowMenus');
})();