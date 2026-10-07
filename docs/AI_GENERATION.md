# Blog / KIN AI generation

`lib/ai/provider.ts` shares only the three provider transports and output-completion
checks. Callers own the model, JSON schema, schema name, prompts, validation and DB writes.

| UI | Provider value | Server environment variable |
| --- | --- | --- |
| OpenAI | `openai` (default) | `OPENAI_API_KEY` |
| Claude | `anthropic` | `ANTHROPIC_API_KEY` |
| Grok | `xai` | `XAI_API_KEY` |

Only the selected provider's key is required. Keys never go into browser requests.
Model defaults are in `app/api/blog/generate/route.ts` and `lib/kin/provider.ts`;
the selectors choose a provider, not an arbitrary model. KIN's branch defaults
are retained. Actual model availability depends on the provider account.

## Blog prompts

Edit `lib/blog-generation/prompts.ts`:

- `BLOG_FIXED_INSTRUCTIONS`: mandatory factuality and output rules.
- `BLOG_CONTENT_STRATEGY_GUIDE`: empty slot for curated `CONTENT_STRATEGY.md` guidance.
- `BLOG_COPYWRITING_SKILLS_GUIDE`: empty slot for curated `COPYWRITING_SKILLS.md` guidance.

The Markdown files are not read automatically. Reference guides are serialized
separately from product facts and task-specific instructions. Fixed rules take
priority, followed by explicit task instructions, then reference style guidance.
Existing `keyword`, `topic`, `purpose`, `instructions` and Draft storage fields
are unchanged. Provider omission still means OpenAI. All responses are validated
before saving; providers are not silently switched on failure.

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
