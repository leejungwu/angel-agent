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

## Manual blog publishing preparation

The app prepares content; users paste text and insert photos in Naver themselves.
Playwright, persistent profiles, automatic editor input and publish APIs have been removed.
Open /content/blog/publishing for approved drafts or /content/blog/{taskId}/prepare
for a task. A draftId query selects the exact stored draft within that task.
Title copy uses plain text. Body copy includes numbered photo insertion markers by
default; users can omit them. Preview markers and downloadable filenames share
sort_order ASC, id ASC ordering. Individual downloads retain image extensions;
bulk download produces blog-{taskId}-images.zip without an added dependency.

lib/blog-publishing/image-layout.ts retains planBlogImages as a pure planner.
It can split prose at sentence/whitespace boundaries and distribute ordered markers;
it never changes the stored Draft. Existing publishing_status values are historical
metadata only: preparation does not simulate browser completion or publication.
No migration is needed. test:blog-body covers copy/layout/filenames/ZIP offline.

## Blog task photos

Apply `supabase/migrations/202610100001_create_blog_task_assets.sql` once before
using the task photo UI. Each task owns ordered
`blog_task_assets` rows and files under `blog-task-assets/tasks/{taskId}/`.
The bucket is private but follows the existing internal-development anon RLS
style; it is not a per-user authorization boundary. Existing `product_assets`
remain untouched; publishing preparation uses task photos only. No old images are copied:
upload each post's own photos. Removing a task requires deleting its photos
first, so the database cascade does not leave Storage files behind. On delete
failure, the UI reports partial progress and attempts to restore the current
object. If restoration fails, keep the reported path for manual repair.
Rollback: revert the photo UI/preparation code and retain the new table and bucket
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
