import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

(function initBlogEditor() {
  const root = document.querySelector('[data-blog-editor]');
  if (!root) return;

  const form = document.getElementById('blogPostForm');
  const htmlField = document.getElementById('blogContentHtml');
  const editorMount = document.getElementById('blogTiptapEditor');
  const toolbarEl = document.getElementById('blogTiptapToolbar');
  const saveStatusEl = document.getElementById('blogEditorSaveStatus');
  const slugInput = form?.querySelector('[name="slug"]');
  const titleInput = form?.querySelector('[name="title"]');
  const tagsHidden = document.getElementById('blogTagsHidden');
  const permalinkSlug = document.getElementById('blogPermalinkSlug');
  const permalinkEdit = document.getElementById('blogPermalinkEdit');
  const wordCountEl = document.getElementById('blogEditorWordCount');
  const readingEl = document.getElementById('blogEditorReadingTime');
  function currentCsrf() {
    return (
      form?.querySelector('[name="_csrf"]')?.value ||
      root.dataset.csrf ||
      ''
    );
  }
  const postId = root.dataset.postId ? parseInt(root.dataset.postId, 10) : null;
  const postStatus = root.dataset.postStatus || 'draft';
  const autosaveOn = root.dataset.autosave !== '0';
  const slugLocked = root.dataset.slugLocked === '1' || postStatus === 'published';

  let slugManual = slugLocked;
  let dirty = false;
  let autosaveTimer = null;
  let lastAutosaveAt = 0;
  let saving = false;

  function setSaveStatus(state, detail) {
    if (!saveStatusEl) return;
    const map = {
      unsaved: 'Unsaved',
      saving: 'Saving…',
      saved: 'Saved',
      error: 'Save failed',
    };
    saveStatusEl.textContent = map[state] || state;
    saveStatusEl.dataset.state = state;
    if (detail) saveStatusEl.title = detail;
  }

  function slugifyTitle(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  function syncPermalinkDisplay() {
    if (permalinkSlug && slugInput) permalinkSlug.textContent = slugInput.value || '…';
  }

  if (titleInput && slugInput) {
    titleInput.addEventListener('input', () => {
      if (!slugManual && (postStatus === 'draft' || !postId)) {
        slugInput.value = slugifyTitle(titleInput.value);
        syncPermalinkDisplay();
      }
      markDirty();
    });
    slugInput.addEventListener('input', () => {
      slugManual = true;
      root.dataset.slugLocked = '1';
      syncPermalinkDisplay();
      markDirty();
    });
  }

  if (permalinkEdit && slugInput) {
    permalinkEdit.addEventListener('click', () => {
      slugInput.focus();
      slugInput.select();
    });
  }
  syncPermalinkDisplay();

  const initialHtml = htmlField?.value || '';

  const editor = new Editor({
    element: editorMount,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder: 'Write your article…' }),
    ],
    content: initialHtml || '',
    editorProps: {
      attributes: { class: 'blogEditor__prose', 'aria-label': 'Article body' },
    },
    onUpdate: () => {
      syncHtmlField();
      updateCounts();
      markDirty();
      scheduleAutosave();
    },
  });

  function syncHtmlField() {
    if (!htmlField) return;
    const empty = editor.isEmpty;
    htmlField.value = empty ? '' : editor.getHTML();
  }

  function updateCounts() {
    const text = editor.getText().trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const mins = Math.max(1, Math.ceil(words / 200));
    if (wordCountEl) wordCountEl.textContent = `${words} words`;
    if (readingEl) readingEl.textContent = `~${mins} min read`;
  }
  updateCounts();

  function markDirty() {
    dirty = true;
    setSaveStatus('unsaved');
  }

  function toolbarBtn(action, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'blogEditor__toolBtn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      action();
      editor.commands.focus();
    });
    return btn;
  }

  if (toolbarEl) {
    const cmds = [
      () => editor.chain().focus().toggleBold().run(),
      () => editor.chain().focus().toggleItalic().run(),
      () => editor.chain().focus().toggleUnderline().run(),
      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      () => editor.chain().focus().toggleBulletList().run(),
      () => editor.chain().focus().toggleOrderedList().run(),
      () => editor.chain().focus().toggleBlockquote().run(),
      () => editor.chain().focus().toggleCodeBlock().run(),
    ];
    const labels = ['B', 'I', 'U', 'H2', 'H3', '•', '1.', '❝', '</>'];
    labels.forEach((label, i) => toolbarEl.appendChild(toolbarBtn(cmds[i], label)));

    const linkBtn = toolbarBtn(() => {
      const prev = editor.getAttributes('link').href;
      const url = window.prompt('Link URL', prev || 'https://');
      if (url === null) return;
      if (!url) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }, 'Link');
    toolbarEl.appendChild(linkBtn);

    const imgBtn = toolbarBtn(() => {
      const input = document.getElementById('blogContentImageInput');
      if (input) input.click();
    }, 'Img');
    toolbarEl.appendChild(imgBtn);
  }

  async function uploadContentImage(file) {
    if (!postId || !file) {
      window.alert('Save the draft first to upload inline images.');
      return;
    }
    const fd = new FormData();
    fd.append('image', file);
    const csrf = currentCsrf();
    fd.append('_csrf', csrf);
    const res = await fetch(`/admin/blog/${postId}/content-image`, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    editor.chain().focus().setImage({ src: data.url, alt: data.alt || '' }).run();
  }

  const contentImageInput = document.getElementById('blogContentImageInput');
  if (contentImageInput) {
    contentImageInput.addEventListener('change', async () => {
      const file = contentImageInput.files?.[0];
      contentImageInput.value = '';
      if (!file) return;
      try {
        await uploadContentImage(file);
      } catch (err) {
        window.alert(err.message || 'Could not upload image');
      }
    });
  }

  function collectAutosavePayload() {
    syncHtmlField();
    const tagsVal = tagsHidden?.value || form?.querySelector('[name="tags"]')?.value || '';
    const csrf = currentCsrf();
    return {
      _csrf: csrf,
      title: titleInput?.value || '',
      slug: slugInput?.value || '',
      excerpt: form?.querySelector('[name="excerpt"]')?.value || '',
      content_html: htmlField?.value || '',
      meta_title: form.querySelector('[name="meta_title"]')?.value,
      meta_description: form.querySelector('[name="meta_description"]')?.value,
      meta_keywords: form.querySelector('[name="meta_keywords"]')?.value,
      canonical_url: form.querySelector('[name="canonical_url"]')?.value,
      og_title: form.querySelector('[name="og_title"]')?.value,
      og_description: form.querySelector('[name="og_description"]')?.value,
      robots: form.querySelector('[name="robots"]')?.value,
      source_url: form.querySelector('[name="source_url"]')?.value,
      category_id: form.querySelector('[name="category_id"]')?.value,
      status: form.querySelector('[name="status"]')?.value,
      scheduled_at: form.querySelector('[name="scheduled_at"]')?.value,
      featured_image_alt: form.querySelector('[name="featured_image_alt"]')?.value,
      tags: tagsVal,
    };
  }

  async function runAutosave() {
    if (!autosaveOn || saving) return;
    const now = Date.now();
    if (now - lastAutosaveAt < 15000 && !dirty) return;
    if (!dirty) return;

    const payload = collectAutosavePayload();
    if (!payload.title?.trim() && !payload.content_html?.trim()) return;

    saving = true;
    setSaveStatus('saving');
    try {
      const url = postId ? `/admin/blog/${postId}/autosave` : '/admin/blog/autosave';
      const method = postId ? 'PATCH' : 'POST';
      const csrf = currentCsrf();
      payload._csrf = csrf;
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data.error && /csrf/i.test(data.error)) {
          throw new Error('Session expired — refresh the page and try again.');
        }
        throw new Error(data.error || 'Autosave failed');
      }

      if (!postId && data.postId) {
        root.dataset.postId = String(data.postId);
        window.history.replaceState({}, '', `/admin/blog/${data.postId}/edit`);
        root.dataset.autosave = '1';
        location.reload();
        return;
      }

      dirty = false;
      lastAutosaveAt = Date.now();
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error', err.message);
    } finally {
      saving = false;
    }
  }

  function scheduleAutosave() {
    if (!autosaveOn) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runAutosave, 3000);
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* Tag chips */
  const tagWrap = document.getElementById('blogTagChips');
  const tagSearch = document.getElementById('blogTagSearch');
  const tagSuggest = document.getElementById('blogTagSuggest');
  let selectedTags = [];
  try {
    selectedTags = JSON.parse(tagsHidden?.value || '[]');
    if (!Array.isArray(selectedTags)) selectedTags = [];
  } catch {
    selectedTags = (tagsHidden?.value || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  function syncTagsHidden() {
    const names = selectedTags.map((t) => t.name).join(', ');
    if (tagsHidden) tagsHidden.value = names;
    const legacy = form?.querySelector('input[name="tags"][type="text"]');
    if (legacy) legacy.value = names;
  }

  function renderTags() {
    if (!tagWrap) return;
    tagWrap.innerHTML = '';
    selectedTags.forEach((tag, idx) => {
      const chip = document.createElement('span');
      chip.className = 'blogEditor__tagChip';
      chip.textContent = tag.name;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'blogEditor__tagChipRemove';
      rm.setAttribute('aria-label', `Remove ${tag.name}`);
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        selectedTags.splice(idx, 1);
        renderTags();
        syncTagsHidden();
        markDirty();
        scheduleAutosave();
      });
      chip.appendChild(rm);
      tagWrap.appendChild(chip);
    });
    syncTagsHidden();
  }
  renderTags();

  async function fetchTagSuggestions(q) {
    if (!q || q.length < 1) {
      if (tagSuggest) tagSuggest.hidden = true;
      return;
    }
    const res = await fetch(`/admin/blog/tags/lookup?q=${encodeURIComponent(q)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({ tags: [] }));
    if (!tagSuggest) return;
    tagSuggest.innerHTML = '';
    const tags = data.tags || [];
    if (!tags.length) {
      tagSuggest.hidden = true;
      return;
    }
    tags.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'blogEditor__tagSuggestItem';
      btn.textContent = t.name;
      btn.addEventListener('click', () => addTagName(t.name));
      tagSuggest.appendChild(btn);
    });
    tagSuggest.hidden = false;
  }

  function addTagName(name) {
    const n = String(name || '').trim();
    if (!n) return;
    if (selectedTags.some((t) => t.name.toLowerCase() === n.toLowerCase())) return;
    selectedTags.push({ name: n });
    renderTags();
    if (tagSearch) tagSearch.value = '';
    if (tagSuggest) tagSuggest.hidden = true;
    markDirty();
    scheduleAutosave();
  }

  if (tagSearch) {
    let tagDebounce;
    tagSearch.addEventListener('input', () => {
      clearTimeout(tagDebounce);
      tagDebounce = setTimeout(() => fetchTagSuggestions(tagSearch.value.trim()), 200);
    });
    tagSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagName(tagSearch.value);
      }
    });
  }

  /* Thumbnail drag/drop */
  const thumbInput = document.getElementById('blogThumbInput');
  const thumbPreview = document.getElementById('blogThumbPreview');
  const thumbEmpty = document.getElementById('blogThumbEmpty');
  const thumbPickBtn = document.getElementById('blogThumbPick');
  const thumbDrop = document.getElementById('blogThumbDrop');

  function showThumbPreviewFromFile(file) {
    if (!file || !thumbPreview) return;
    const url = URL.createObjectURL(file);
    thumbPreview.src = url;
    thumbPreview.hidden = false;
    if (thumbEmpty) thumbEmpty.hidden = true;
    thumbPreview.dataset.objectUrl = url;
  }

  if (thumbPickBtn && thumbInput) {
    thumbPickBtn.addEventListener('click', () => thumbInput.click());
    thumbInput.addEventListener('change', () => {
      const file = thumbInput.files?.[0];
      if (file) showThumbPreviewFromFile(file);
    });
  }
  if (thumbDrop && thumbInput) {
    ['dragenter', 'dragover'].forEach((ev) => {
      thumbDrop.addEventListener(ev, (e) => {
        e.preventDefault();
        thumbDrop.classList.add('is-dragover');
      });
    });
    thumbDrop.addEventListener('dragleave', () => thumbDrop.classList.remove('is-dragover'));
    thumbDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      thumbDrop.classList.remove('is-dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && thumbInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        thumbInput.files = dt.files;
        showThumbPreviewFromFile(file);
      }
    });
  }

  /* SEO preview counters */
  document.querySelectorAll('[data-seo-count]').forEach((el) => {
    const target = el.getAttribute('data-seo-count');
    const input = form?.querySelector(`[name="${target}"]`);
    if (!input) return;
    const counter = el;
    const update = () => {
      counter.textContent = `${(input.value || '').length}`;
    };
    input.addEventListener('input', update);
    update();
  });

  const serpTitle = document.getElementById('blogSerpTitle');
  const serpDesc = document.getElementById('blogSerpDesc');
  const serpUrl = document.getElementById('blogSerpUrl');
  function updateSerp() {
    const t = form?.querySelector('[name="meta_title"]')?.value?.trim() || titleInput?.value?.trim() || 'Article title';
    const d =
      form?.querySelector('[name="meta_description"]')?.value?.trim() ||
      form?.querySelector('[name="excerpt"]')?.value?.trim() ||
      'Add a meta description for search results.';
    const slug = slugInput?.value || 'slug';
    if (serpTitle) serpTitle.textContent = t;
    if (serpDesc) serpDesc.textContent = d;
    if (serpUrl) serpUrl.textContent = `/blog/${slug}`;
  }
  form?.querySelectorAll('[name="meta_title"], [name="meta_description"], [name="excerpt"]').forEach((el) => {
    el.addEventListener('input', updateSerp);
  });
  titleInput?.addEventListener('input', updateSerp);
  slugInput?.addEventListener('input', updateSerp);
  updateSerp();

  /* Publish modal */
  const publishModal = document.getElementById('blogPublishModal');
  const publishOpen = document.getElementById('blogPublishOpen');
  const publishConfirm = document.getElementById('blogPublishConfirm');
  const publishForm = document.getElementById('blogPublishForm');

  if (publishOpen && publishModal) {
    publishOpen.addEventListener('click', (e) => {
      e.preventDefault();
      syncHtmlField();
      const summaryTitle = document.getElementById('blogPublishSummaryTitle');
      const summarySlug = document.getElementById('blogPublishSummarySlug');
      if (summaryTitle) summaryTitle.textContent = titleInput?.value || '(no title)';
      if (summarySlug) summarySlug.textContent = `/blog/${slugInput?.value || ''}`;
      publishModal.setAttribute('aria-hidden', 'false');
      publishModal.classList.add('is-open');
    });
  }
  publishModal?.querySelectorAll('[data-publish-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      publishModal.classList.remove('is-open');
      publishModal.setAttribute('aria-hidden', 'true');
    });
  });
  if (publishConfirm && publishForm) {
    publishConfirm.addEventListener('click', () => {
      syncHtmlField();
      publishForm.submit();
    });
  }

  const saveDraftBtn = document.getElementById('blogSaveDraft');
  const savePublishBtn = document.getElementById('blogSavePublish');
  if (form) {
    form.addEventListener('submit', (e) => {
      syncHtmlField();
      const submitter = e.submitter;
      const statusSel = form.querySelector('[name="status"]');
      const publishFlag = submitter?.name === 'publish_after_save' && submitter.value === '1';
      if (publishFlag && statusSel) {
        const opt = statusSel.querySelector('option[value="published"]');
        if (!opt) {
          const o = document.createElement('option');
          o.value = 'published';
          o.textContent = 'published';
          statusSel.appendChild(o);
        }
        statusSel.value = 'published';
      } else if (statusSel && postStatus !== 'published') {
        statusSel.value = 'draft';
      }
      dirty = false;
    });
  }
  if (saveDraftBtn && form) {
    saveDraftBtn.addEventListener('click', () => {
      const statusSel = form.querySelector('[name="status"]');
      if (statusSel && postStatus !== 'published') statusSel.value = 'draft';
    });
  }

})();