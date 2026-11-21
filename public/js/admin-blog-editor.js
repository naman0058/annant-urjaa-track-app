(function () {
  const root = document.querySelector('[data-blog-editor]');
  if (!root) return;

  const form = document.getElementById('blogPostForm');
  const htmlField = document.getElementById('blogContentHtml');
  const editorEl = document.getElementById('blogContentEditor');
  const thumbInput = document.getElementById('blogThumbInput');
  const thumbPreview = document.getElementById('blogThumbPreview');
  const thumbEmpty = document.getElementById('blogThumbEmpty');
  const thumbPickBtn = document.getElementById('blogThumbPick');
  const initialHtml = htmlField ? htmlField.value : '';

  function initQuill() {
    if (!editorEl || typeof Quill === 'undefined') return null;
    const quill = new Quill(editorEl, {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: [2, 3, 4, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          ['link'],
          ['clean'],
        ],
      },
      placeholder: 'Write your article…',
    });
    if (initialHtml) {
      quill.clipboard.dangerouslyPasteHTML(initialHtml);
    }
    return quill;
  }

  const quill = initQuill();

  function syncHtml() {
    if (!htmlField) return;
    if (quill) {
      const empty = quill.getText().trim().length === 0 && quill.root.classList.contains('ql-blank');
      htmlField.value = empty ? '' : quill.root.innerHTML;
    }
  }

  if (form) {
    form.addEventListener('submit', syncHtml);
  }

  function showThumbPreviewFromFile(file) {
    if (!file || !thumbPreview) return;
    const url = URL.createObjectURL(file);
    thumbPreview.src = url;
    thumbPreview.hidden = false;
    if (thumbEmpty) thumbEmpty.hidden = true;
    thumbPreview.dataset.objectUrl = url;
  }

  function revokeThumbUrl() {
    if (thumbPreview && thumbPreview.dataset.objectUrl) {
      URL.revokeObjectURL(thumbPreview.dataset.objectUrl);
      delete thumbPreview.dataset.objectUrl;
    }
  }

  if (thumbPickBtn && thumbInput) {
    thumbPickBtn.addEventListener('click', () => thumbInput.click());
    thumbInput.addEventListener('change', () => {
      const file = thumbInput.files && thumbInput.files[0];
      if (file) showThumbPreviewFromFile(file);
    });
  }

  window.addEventListener('beforeunload', revokeThumbUrl);
})();