(function () {
  'use strict';

  function positionRowMenu(details) {
    const panel = details.querySelector('.rowMenu__panel');
    if (!panel) return;
    if (!details.open) {
      panel.classList.remove('is-floating');
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.width = '';
      panel.style.minWidth = '';
      return;
    }
    const rect = details.querySelector('summary')?.getBoundingClientRect();
    if (!rect) return;
    panel.classList.add('is-floating');
    panel.style.width = 'max-content';
    panel.style.minWidth = '';
    panel.style.left = 'auto';
    panel.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    panel.style.top = `${rect.bottom + 3}px`;
  }

  function closeRowMenu(details) {
    if (!details || !details.open) return;
    details.open = false;
    positionRowMenu(details);
  }

  function bind(root, closeGlobalName) {
    if (!root) return;

    const closeAllRowMenus = () => {
      root.querySelectorAll('[data-row-menu][open]').forEach((d) => closeRowMenu(d));
    };

    if (closeGlobalName) {
      window[closeGlobalName] = closeAllRowMenus;
    }

    root.querySelectorAll('[data-row-menu]').forEach((details) => {
      details.addEventListener('toggle', () => {
        if (details.open) {
          root.querySelectorAll('[data-row-menu][open]').forEach((d) => {
            if (d !== details) closeRowMenu(d);
          });
          requestAnimationFrame(() => positionRowMenu(details));
        } else {
          positionRowMenu(details);
        }
      });
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.target.closest('[data-row-menu]')) return;
        closeAllRowMenus();
      },
      true
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllRowMenus();
    });

    window.addEventListener(
      'scroll',
      () => {
        if (root.querySelector('[data-row-menu][open]')) closeAllRowMenus();
      },
      true
    );

    window.addEventListener('resize', () => {
      root.querySelectorAll('[data-row-menu][open]').forEach((d) => positionRowMenu(d));
    });

    root.querySelectorAll('[data-row-menu] a[href]').forEach((link) => {
      link.addEventListener('click', () => closeRowMenu(link.closest('[data-row-menu]')));
    });
  }

  window.AdminRowMenu = { bind, closeRowMenu, positionRowMenu };
})();