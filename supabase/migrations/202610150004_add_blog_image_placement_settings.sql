BEGIN;

-- NULL keeps the existing even layout with automatic prose splitting.
ALTER TABLE public.blog_tasks ADD COLUMN image_placement_settings jsonb;

COMMIT;
