BEGIN;

-- Change only the existing DELETE policy; preserve its roles and other RLS policies.
-- No Job, Draft, Task, snapshot or Storage object is deleted by this migration.
ALTER POLICY blog_publication_jobs_delete ON public.blog_publication_jobs
  USING (status IN ('queued', 'inserted'));

-- Rollback: ALTER POLICY blog_publication_jobs_delete ON public.blog_publication_jobs USING (status = 'queued');
COMMIT;
