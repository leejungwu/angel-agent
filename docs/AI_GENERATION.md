# Blog / KIN AI generation

`lib/ai/provider.ts` shares only the three provider transports and output-completion
checks. Callers own the model, JSON schema, schema name, prompts, validation and DB writes.

| UI | Provider value | Server environment variable |
| --- | --- | --- |
| OpenAI | `openai` (default) | `OPENAI_API_KEY` |
| Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| Grok | `xai` | `XAI_API_KEY` |

Only the selected provider's key is required. Keys never go into browser requests.
Blog model options and defaults are in `lib/blog-generation/models.ts`.
The Blog UI selects a provider and one of its allowed models. Changing provider
resets the selection to its default: OpenAI `gpt-6.1-sol`, Claude
`claude-sonnet-5-5`, Grok `grok-4.7`. The API validates the provider/model pair
before any lookup or provider call; an omitted model uses the provider default.
Unknown models and mismatched pairs return HTTP 400. Reloaded drafts select their
stored model only if it is still allowed; otherwise they use the provider default.
The actual response model is still saved in `blog_drafts.model`. No Auto/Jev
routing is used. KIN defaults remain in `lib/kin/provider.ts` and are unchanged.
Actual model availability depends on the provider account.

## Blog prompts

Edit `lib/blog-generation/prompts.ts`:

- `BLOG_FIXED_INSTRUCTIONS`: mandatory factuality and output rules.
- `BLOG_CONTENT_STRATEGY_GUIDE`: empty slot for curated `CONTENT_STRATEGY.md` guidance.
- `BLOG_COPYWRITING_SKILLS_GUIDE`: empty slot for curated `COPYWRITING_SKILLS.md` guidance.

The Markdown files are not read automatically. Reference guides are serialized
separately from product facts and task-specific instructions. Fixed rules take
priority, followed by explicit task instructions, then reference style guidance.
Blog tasks pass `keyword`, `topic`, `instructions`, not the legacy `purpose`
column. Draft storage fields are unchanged. Provider omission still means OpenAI. All responses are validated
before saving; providers are not silently switched on failure.

Blog body length targets 1,500 characters, with an inclusive 1,200–1,800 range.
`lib/blog-generation/body.ts` counts intro, section headings/bodies and closing;
it excludes the title, line breaks and field-edge whitespace, includes internal
spaces, and counts Unicode code points. Out-of-range output is saved with a
warning, not rejected. The API returns `bodyLength`; the editor recalculates it
for saved and edited drafts. Explicit task length instructions take priority.

`lib/naver-blog/image-layout.ts` distributes images across prose paragraph
boundaries, not section headings. If paragraphs are insufficient, it splits
longer prose at sentence/whitespace boundaries without splitting words. Images
retain asset order; indivisible short prose uses balanced groups. This changes
only publisher input, not stored Draft data. The publisher still inputs all text
first and uploads one image at a time, checking body preservation and image DOM
order. `npm run test:blog-body` tests the plan offline; real Naver editor behavior
and visual spacing still require a separate E2E check without final publishing.

## Blog task photos

Apply `supabase/migrations/202610100001_create_blog_task_assets.sql` once before
using the photo UI or the updated publisher. Each task owns ordered
`blog_task_assets` rows and files under `blog-task-assets/tasks/{taskId}/`.
The bucket is private but follows the existing internal-development anon RLS
style; it is not a per-user authorization boundary. Existing `product_assets`
remain untouched and are no longer a publisher input. No old images are copied:
upload each post's own photos. Removing a task requires deleting its photos
first, so the database cascade does not leave Storage files behind. On delete
failure, the UI reports partial progress and attempts to restore the current
object. If restoration fails, keep the reported path for manual repair.
Rollback: revert the photo UI/publisher code and retain the new table and bucket
until their files and metadata are separately audited; do not drop them blindly.

## KIN integration

The KIN API, UI, presets and quality checks were brought from
`origin/feat/kin-prompt-tuning` (`b3e121d`) without merging unrelated product,
publishing-queue or Naver publisher changes. `lib/kin/provider.ts` remains a
small compatibility wrapper around the shared provider.

The imported SQL files supply the KIN tables/presets and its existing VOC lookup
dependency. They are **not executed automatically**:

1. `202610060001_create_voc_intelligence.sql`
2. `202610060002_create_kin_content.sql`
3. `202610060003_create_kin_prompt_presets.sql`

Use the existing Supabase migration history to apply only migrations not already
applied. The imported SQL assumes the existing `products` table. Blog requires
no new table or column for provider selection.

## Checks

`npm run test:ai-providers` uses SDK and DB doubles, without paid API calls,
database writes or Naver access. Also run TypeScript, ESLint and `npm run build`.
