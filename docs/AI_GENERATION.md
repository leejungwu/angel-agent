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

## Blog prompts and snapshots

Blog writing instructions live in editable `blog_prompt_presets`, not runtime constants.
The task screen exposes system, strategy, style and article prompts, plus explicit
min/target/max characters, section count and keyword usage bounds. The five seed
presets preserve the former common/template/natural-tone/medium-exposure/no-CTA
text verbatim. Informational is the initial default.

The generation request contains only taskId, presetId, provider and model. The server
loads Task, Product and Preset. Omitted presetId resolves to Task preset_id, then a
default preset. Missing selection/default is an explicit error. Prompt assembly uses
preset.system_prompt verbatim, and serializes the remaining preset settings, product
facts and Task keyword/topic/instructions without appending hidden writing prose.
No Markdown prompt files are loaded. The output schema remains a program contract.

Apply `202610150001_create_blog_prompt_presets.sql` before using this path; it is not
automatically applied. The old generation_settings column and data remain untouched,
but the application no longer reads or writes them. The old settings UI/API are removed.
Rollback means reverting application code while retaining additive tables/columns.

Each new Draft saves provider, actual response model and a versioned generation_snapshot:
all four prompts and numeric settings, preset identity, Task fields, product facts,
provider, requested model and response model. Preset edits/deletion never rewrite past
snapshots. History shows the selected Draft's original settings and read-only prompts;
old Drafts without snapshots explicitly show that no generation settings were recorded.
Regeneration uses current Task/Product and the current selected preset, adding a Draft.
This generation snapshot does not freeze publishing images or execution state.

Body length counts intro, section headings/bodies and closing, excluding title, line
breaks and field-edge whitespace, including internal spaces and Unicode code points.
New Drafts use the preset's exact min/max values, without a percentage adjustment.
Out-of-range text is saved with a warning. Blank required Draft strings are rejected.
Provider failure never silently switches providers.

## Blog generation and Naver input responsibilities

The generation API owns product/task retrieval, AI transport, output validation and
draft storage. It does not control Naver. Chrome Extension background owns CDP
commands and upload sequencing; its content script owns SmartEditor DOM and
selection checks. The server Extension API owns draft/asset retrieval, blocks,
signed URLs and local temporary files. Final review and publishing belong to the user.

Current architecture follows main ffcca198: Chrome Extension + CDP + content script.
The former Playwright publisher, persistent profile, /api/blog/publish,
PublishingStatusControl and Naver live test script are absent from current main.
Automatic editor input now uses the Extension; final publish/reservation clicks
are not automated.

## V3 Block input

Side Panel reads the task list, keeps the selected draftId and requests
/api/extension/blog-tasks/{taskId}?draftId={draftId}. getExtensionBlogTask verifies
the draft belongs to the task, orders blog_task_assets by sort_order ASC / id ASC,
reuses planBlogImages and serializes all photos through createBlogExecutionBlocks.
Text blocks concatenate to the clean body exactly. Signed URLs expire after 600
seconds; automatic refresh is not implemented. Images are task-owned, with no
draft-specific image snapshot. The Extension list selects the newest approved draft
per task, and the detail API rejects explicit draftIds that are not approved (403,
DRAFT_NOT_APPROVED). Tasks with no approved draft are omitted from the list and
return 409 / NO_APPROVED_DRAFT on a detail request without draftId. Side Panel
rechecks the same draftId on input click before editor diagnostics or input.
Editing an approved draft still retains its status; reapproval after editing is a separate task.

V3 processes text/image blocks from beginning to end without an image-count cap.
Input.insertText handles text; the temp-image API and DOM.setFileInputFiles handle
images. Native dialogs are suppressed for the loop, while each current file input
is queried through DOM.getDocument. No chooser event wait is required in V3.
The server and Chrome must share the same PC for absolute temporary paths to work.
Cleanup runs in finally with retries; abnormal-exit cleanup and resumable input are pending.

User-confirmed operational verification: a real stored draft and all 10 photos
were entered in Naver SmartEditor, in text/image order through the final body text.
The message "입력 완료 - 네이버에서 직접 확인 후 발행하세요" was confirmed.
This documentation task did not rerun Naver or provider APIs. The 10-image success
does not mark approval enforcement, stronger upload/order checks or recovery as complete.
Legacy maximum-3-image input remains a selectable fallback; it is not removed.

## Manual blog publishing preparation / fallback

The /prepare screen provides manual copy, inspection and fallback materials.
It does not launch the Extension. In this path users paste text and insert photos themselves.
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

## KIN prompts and answer history

Apply `202610150002_kin_common_prompts.sql` before using the common prompt editor or
new answer history fields. It seeds the former fixed/common-style text verbatim in
a singleton table and adds nullable provider/question_intent to kin_drafts. No old
Task, preset snapshot or answer is rewritten. The migration is not auto-applied.

`lib/kin/prompts.ts` assembles editable DB common prompts, the selected preset
snapshot, question instructions and Product/VOC context. It sends only JSON priority
and product-mention contracts in the system role; no hidden writing prose is added.
Priority is output schema/program contract, question instructions, preset, common
prompt. Structured preset configuration is passed as data, without prose templates.
The common editor is collapsed by default; preset CRUD and provider transport remain
separate. Missing common settings fail explicitly instead of using code defaults.

Preset character bounds follow the 200–1500 answer schema range. Out-of-range old
settings are preserved and rejected with guidance when used, never silently clamped.
Direct requires the selected product name in the actual answer. None forbids both
name and brand. productMentioned must match actual name/brand presence and is false
without a selected product. These hard checks precede draft saving; existing quality
checks remain warnings. They do not prove semantic relevance or medical accuracy.

Recent Task items load their saved Drafts on demand through
`/api/kin/tasks/[id]/drafts`, with answer intent/provider/model/date and copy. Older
missing metadata is shown as unrecorded. No answer editing, approval, queue or
automated Naver registration is introduced.

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
applied. The imported SQL assumes the existing `products` table. Blog provider and generation snapshots use the additive Blog preset migration described above.

## Checks

`npm run test:ai-providers` uses SDK and DB doubles, without paid API calls,
database writes or Naver access. Also run TypeScript, ESLint and `npm run build`.
