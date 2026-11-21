# Blog editor QA matrix (Phase 6)

Run after `npm run build:admin-css`, `npm run build:admin-blog-editor`, and `npm test`.

| ID | Check | Pass |
|----|--------|------|
| A | New post: title is first focusable field | ☐ |
| B | Sticky header shows Save draft / Publish (edit) | ☐ |
| C | Save status cycles Unsaved → Saving → Saved on autosave | ☐ |
| D | Tiptap toolbar: bold, lists, link, image | ☐ |
| E | Slug auto from title on draft; locked when published | ☐ |
| F | Settings accordions: featured + publishing open by default | ☐ |
| G | Mobile: Settings drawer opens | ☐ |
| H | Tag lookup chips add/remove | ☐ |
| I | Inline image upload (edit post only) | ☐ |
| J | Authenticated preview (`/admin/blog/:id/preview`) noindex | ☐ |
| K | Publish modal confirms then publishes | ☐ |
| L | XSS in body stripped on save | ☐ |
| M | Scheduled post publishes via worker / CLI | ☐ |
| N | CSRF rejected on autosave without token | ☐ |
| O | Featured image drag/drop | ☐ |