(function () {
  'use strict';

  const layout = document.getElementById('adminLayout');
  const overlay = document.getElementById('adminOverlay');
  const menuBtn = document.getElementById('adminMenuBtn');

  function setNavOpen(open) {
    if (!layout) return;
    layout.classList.toggle('is-nav-open', open);
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => setNavOpen(!layout.classList.contains('is-nav-open')));
  }
  if (overlay) {
    overlay.addEventListener('click', () => setNavOpen(false));
  }

  document.querySelectorAll('.admin-toast').forEach((toast) => {
    const close = toast.querySelector('.admin-toast__close');
    const remove = () => toast.remove();
    if (close) close.addEventListener('click', remove);
    setTimeout(remove, 6000);
  });

  const searchInput = document.getElementById('adminGlobalSearch');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = searchInput.value.trim();
      if (q.length >= 2) window.location.href = '/admin/search?q=' + encodeURIComponent(q);
    });
  }

  let lastFocus = null;

  function setDrawerOpen(id, open) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('is-open', open);
    el.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      if (typeof window.closeSubscriptionRowMenus === 'function') {
        window.closeSubscriptionRowMenus();
      }
      if (typeof window.closeTransactionRowMenus === 'function') {
        window.closeTransactionRowMenus();
      }
      if (typeof window.closeMasterRowMenus === 'function') {
        window.closeMasterRowMenus();
      }
      if (typeof window.closeCategoryRowMenus === 'function') {
        window.closeCategoryRowMenus();
      }
      if (typeof window.closeTrackRowMenus === 'function') {
        window.closeTrackRowMenus();
      }
      if (typeof window.closeBlogRowMenus === 'function') {
        window.closeBlogRowMenus();
      }
      if (typeof window.closeUsersRowMenus === 'function') {
        window.closeUsersRowMenus();
      }
      if (typeof window.closeStaffRowMenus === 'function') {
        window.closeStaffRowMenus();
      }
      lastFocus = document.activeElement;
      const panel = el.querySelector('.filterDrawer__panel');
      const focusable = panel?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }
  }

  window.setDrawerOpen = setDrawerOpen;

  document.querySelectorAll('[data-filter-open]').forEach((btn) => {
    btn.addEventListener('click', () => setDrawerOpen(btn.getAttribute('data-filter-open'), true));
  });
  document.querySelectorAll('[data-filter-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const drawer = btn.closest('.filterDrawer');
      if (drawer) setDrawerOpen(drawer.id, false);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.filterDrawer.is-open').forEach((drawer) => {
      setDrawerOpen(drawer.id, false);
    });
  });

  const profile = document.querySelector('[data-profile-toggle]');
  if (profile) {
    profile.addEventListener('click', () => profile.closest('.admin-profileMenu')?.classList.toggle('is-open'));
  }
})();