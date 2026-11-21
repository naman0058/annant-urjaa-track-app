(function () {
  'use strict';

  const page = document.querySelector('[data-blog-article]');
  if (!page) return;

  const shareUrl = page.getAttribute('data-share-url') || window.location.href;

  function copyLink(btn) {
    const done = function () {
      btn.classList.add('is-copied');
      const textEl = btn.querySelector('.blog-article-share-btn__text');
      const iconEl = btn.querySelector('i');
      const prevText = textEl ? textEl.textContent : '';
      const prevIconClass = iconEl ? iconEl.className : '';
      if (textEl) textEl.textContent = 'Copied';
      if (iconEl) {
        iconEl.className = 'fa-solid fa-check';
        iconEl.setAttribute('aria-hidden', 'true');
      }
      btn.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        btn.classList.remove('is-copied');
        if (textEl) textEl.textContent = prevText;
        if (iconEl) iconEl.className = prevIconClass;
        btn.setAttribute('aria-label', 'Copy link to clipboard');
      }, 2200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(done).catch(function () {});
    }
  }

  page.querySelectorAll('[data-copy-link]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyLink(btn);
    });
  });

  const tocLinks = page.querySelectorAll('.blog-article-toc a[href^="#"]');
  if (!tocLinks.length || !('IntersectionObserver' in window)) return;

  const headingIds = [];
  tocLinks.forEach(function (a) {
    const id = a.getAttribute('href').slice(1);
    if (id) headingIds.push(id);
  });

  const headings = headingIds
    .map(function (id) {
      return document.getElementById(id);
    })
    .filter(Boolean);

  if (!headings.length) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        tocLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
        });
      });
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
  );

  headings.forEach(function (h) {
    observer.observe(h);
  });
})();