-- Run this entire file in Supabase SQL Editor BEFORE using the updated publish API.
-- This migration only changes the allowed statuses; existing rows are not rewritten.
BEGIN;

DO $migration$
DECLARE
  status_column smallint;
  existing_checks text[];
BEGIN
  -- The existing text/varchar CHECK constraint name may differ between projects.
  SELECT attnum INTO STRICT status_column
  FROM pg_attribute
  WHERE attrelid = 'public.blog_drafts'::regclass
    AND attname = 'publishing_status' AND NOT attisdropped
    AND atttypid IN ('text'::regtype, 'character varying'::regtype);

  SELECT array_agg(conname::text) INTO existing_checks
  FROM pg_constraint
  WHERE conrelid = 'public.blog_drafts'::regclass
    AND contype = 'c' AND conkey = ARRAY[status_column];

  -- Do not silently remove unrelated checks if this column has multiple constraints.
  IF cardinality(existing_checks) > 1 THEN
    RAISE EXCEPTION 'Multiple publishing_status CHECK constraints found: %. Review them before migration.', existing_checks;
  END IF;
  IF cardinality(existing_checks) = 1 THEN
    EXECUTE format('ALTER TABLE public.blog_drafts DROP CONSTRAINT %I', existing_checks[1]);
  END IF;
END;
$migration$;

ALTER TABLE public.blog_drafts
  ADD CONSTRAINT blog_drafts_publishing_status_check
  CHECK (publishing_status IS NULL OR publishing_status IN (
    'queued', 'publishing', 'ready_for_review', 'published', 'failed'
  ));

COMMIT;
