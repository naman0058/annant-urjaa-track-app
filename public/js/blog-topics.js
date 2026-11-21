(function () {
  'use strict';

  document.querySelectorAll('[data-blog-topics]').forEach(function (root) {
    const btn = root.querySelector('[data-topics-toggle]');
    const panel = root.querySelector('#blog-topics-more');
    if (!btn || !panel) return;

    btn.addEventListener('click', function () {
      const open = panel.hasAttribute('hidden');
      if (open) {
        panel.removeAttribute('hidden');
        panel.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        panel.setAttribute('hidden', '');
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });
})();