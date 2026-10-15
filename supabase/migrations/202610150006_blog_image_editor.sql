BEGIN;

ALTER TABLE public.blog_task_assets
  ADD COLUMN original_storage_path text,
  ADD COLUMN edit_metadata jsonb;

-- Existing rows keep their current path as their implicit original; no backfill.
GRANT UPDATE (storage_path, original_storage_path, edit_metadata)
  ON public.blog_task_assets TO anon, authenticated;
-- Reuse blog_task_assets_update_order's existing internal-tool UPDATE policy.

COMMIT;
