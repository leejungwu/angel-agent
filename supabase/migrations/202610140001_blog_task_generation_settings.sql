-- Task owns generation settings; no draft snapshot or existing row rewrite.
BEGIN;
ALTER TABLE public.blog_tasks
  ADD COLUMN IF NOT EXISTS generation_settings jsonb;
COMMENT ON COLUMN public.blog_tasks.generation_settings IS
  'Task-level Blog generation settings. NULL uses application defaults; validated by application.';
COMMIT;
