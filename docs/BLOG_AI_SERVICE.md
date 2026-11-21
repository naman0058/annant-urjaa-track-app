# Blog AI Service (server-side)

## Stack
- **Official SDK:** `openai` (Responses API via `client.responses.parse`)
- **Structured Outputs:** `zodTextFormat` + strict JSON schema (`services/ai/articleOutputSchema.js`)
- **Re-validation:** Zod `parseArticleOutput()` on every response before DB writes
- **Secrets:** Only via env (`config/blogAiConfig.js`) — never sent to browsers or logs

## Environment
See `.env.example` for:
`OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_CONCURRENT_REQUESTS`, `OPENAI_MAX_RETRIES`, `OPENAI_REQUEST_TIMEOUT`, `BLOG_IMPORT_DIR`, `BLOG_DEFAULT_AUTHOR`, `SITE_BASE_URL`

## Module map
| Path | Role |
|------|------|
| `services/ai/openaiResponsesClient.js` | SDK client, prompts, Responses.parse |
| `services/ai/blogArticleAiService.js` | Rewrite one post, folder bulk |
| `services/ai/articleMapper.js` | Derive slug, canonical, categories, tags, JSON-LD |
| `services/ai/sourceSanitizer.js` | Untrusted source wrapping, URL allowlisting |
| `services/blogRevisionService.js` | Snapshots before AI |
| `services/blogAiService.js` | Queue runner (legacy jobs table) |

## Admin workflows
1. **Single article:** `/admin/blog/:id/ai/preview` → modes `full` | `content` | `metadata`, optional preview-only session
2. **Bulk queue:** `/admin/blog/ai` → queue by post IDs → **Process queued jobs**
3. **Folder:** `/admin/blog/ai` → **Process folder** (requires `BLOG_IMPORT_DIR`)

All saves land in **`review`** or **`draft`** — explicit **Publish** required.

## Trust boundaries
The model does **not** control: final slug (unique check), publish state, image paths, IDs, canonical URL (from `SITE_BASE_URL`), or JSON-LD scripts (built in `utils/jsonLdBlog.js`).

External URLs in output are stripped unless they existed in the source document.