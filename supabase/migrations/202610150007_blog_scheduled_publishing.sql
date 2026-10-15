BEGIN;

ALTER TABLE public.blog_publication_jobs
  ADD COLUMN publish_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN scheduled_at timestamptz,
  ADD CONSTRAINT blog_publication_jobs_schedule_check CHECK (
    (publish_mode = 'manual' AND scheduled_at IS NULL) OR
    (publish_mode = 'scheduled' AND scheduled_at IS NOT NULL AND isfinite(scheduled_at))
  );

-- Execution metadata is fixed at registration, independently of content snapshot.
CREATE FUNCTION public.protect_blog_publication_job_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.publish_mode IS DISTINCT FROM OLD.publish_mode
     OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    RAISE EXCEPTION 'Publication Job schedule is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_publication_job_schedule_immutable
BEFORE UPDATE ON public.blog_publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.protect_blog_publication_job_schedule();

COMMIT;
