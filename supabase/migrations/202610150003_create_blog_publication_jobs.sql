BEGIN;

-- Original Task/Draft CREATE TABLE migrations are not tracked. Resolve their
-- actual ID types in the target schema rather than assuming bigint for both.
DO $migration$
DECLARE
  task_id_type text;
  draft_id_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO STRICT task_id_type
    FROM pg_attribute WHERE attrelid = 'public.blog_tasks'::regclass
      AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  SELECT format_type(atttypid, atttypmod) INTO STRICT draft_id_type
    FROM pg_attribute WHERE attrelid = 'public.blog_drafts'::regclass
      AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  IF task_id_type NOT IN ('bigint', 'integer', 'smallint')
    OR draft_id_type NOT IN ('bigint', 'integer', 'smallint') THEN
    RAISE EXCEPTION 'Expected numeric Blog IDs; found Task %, Draft %', task_id_type, draft_id_type;
  END IF;
  EXECUTE format($table$
    CREATE TABLE public.blog_publication_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      blog_task_id %s NOT NULL REFERENCES public.blog_tasks(id) ON DELETE RESTRICT,
      blog_draft_id %s NOT NULL UNIQUE REFERENCES public.blog_drafts(id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'inserting', 'inserted', 'published', 'failed')),
      execution_snapshot jsonb NOT NULL CHECK (jsonb_typeof(execution_snapshot) = 'object'),
      attempt_no integer NOT NULL DEFAULT 0 CHECK (attempt_no >= 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      inserted_at timestamptz,
      published_at timestamptz,
      published_url text,
      error_message text
    )
  $table$, task_id_type, draft_id_type);
END;
$migration$;

CREATE INDEX blog_publication_jobs_status_created_idx
  ON public.blog_publication_jobs (status, created_at);

-- Execution data and ownership stay frozen; execution state fields may change.
CREATE FUNCTION public.protect_blog_publication_job_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.execution_snapshot IS DISTINCT FROM OLD.execution_snapshot
    OR NEW.blog_task_id IS DISTINCT FROM OLD.blog_task_id
    OR NEW.blog_draft_id IS DISTINCT FROM OLD.blog_draft_id
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Publication Job execution snapshot and source are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_publication_jobs_immutable_snapshot
  BEFORE UPDATE ON public.blog_publication_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_blog_publication_job_snapshot();

-- Match existing internal-tool publishable client access; admin auth is separate work.
ALTER TABLE public.blog_publication_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blog_publication_jobs TO anon, authenticated;
CREATE POLICY blog_publication_jobs_read ON public.blog_publication_jobs
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY blog_publication_jobs_insert ON public.blog_publication_jobs
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY blog_publication_jobs_update ON public.blog_publication_jobs
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY blog_publication_jobs_delete ON public.blog_publication_jobs
  FOR DELETE TO anon, authenticated USING (status = 'queued');

COMMIT;
